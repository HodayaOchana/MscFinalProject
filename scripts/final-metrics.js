/**
 * All the measurements for the final report, in ONE run, on the system as it is now.
 * Runs the existing test scripts one after the other and writes one summary file:
 *   logs/final-metrics-<date>.md   - a table (what, target, result) + the full output of each test
 *
 *   1. Library availability  - availability query < 500 ms at p95 (proposal 7.1)  library/test-availability.js
 *   2. Personal Insights     - 100% match to the raw event log (proposal 7.1)     server/test-insights.js
 *   3. Author Insights       - the author's numbers match the raw data            server/test-author-insights.js
 *   4. New book embedding    - an uploaded book gets the same vector as the catalog  server/test-book-embedding.js
 *   5. Signed-in API, end to end - new user gets 10 picks at once (proposal 7.1 cold start),
 *      search by author / #tag, the fresh For You shelves and their response time   server/test-me-api.js
 *      (needs the server running:  node server/server.js  in another terminal)
 *   6. Real account, READ ONLY - For You load time and checks for a user with lots of data;
 *      nothing is written to that account                                 server/test-me-api.js --read-only
 *
 * Precision@10 is not run here (it takes long) - its result is from hybrid/evaluate.js.
 * Only READS, except step 5, which writes data for the TEST account (and puts it back).
 *
 * Run:  node scripts/final-metrics.js --email test@... --real-email you@...   (asks for both passwords - not shown, not saved)
 *       node scripts/final-metrics.js --email test1@recoread.dev      (step 5 only)
 *       or set TEST_PASSWORD in the terminal first, or pass --password "..." (stays in the terminal history)
 *       node scripts/final-metrics.js                 (without step 5)
 *       node scripts/final-metrics.js --users 30      (fewer users for step 1 - faster)
 */

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const email = arg("--email");          // step 5: a TEST account (written, then put back)
const realEmail = arg("--real-email"); // step 6: a real account (read only)
let password = arg("--password") || process.env.TEST_PASSWORD || null;
let realPassword = null;
const hide = (text) => [password, realPassword].filter(Boolean)
  .reduce((t, p) => t.replaceAll(p, "***"), String(text)); // never printed, never saved

// the password typed without showing it on the screen
let leftover = "";
function askPassword(forEmail) {
  return new Promise((resolve) => {
    process.stdout.write(`Password for ${forEmail}: `);
    const stdin = process.stdin;
    let typed = "";
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onKey = (chunk) => {
      const chars = [...chunk];
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch === "\r" || ch === "\n") {
          if (ch === "\r" && chars[i + 1] === "\n") i++;
          leftover = chars.slice(i + 1).join("");                     // typed ahead (or pasted): for the next question
          stdin.setRawMode?.(false); stdin.pause(); stdin.off("data", onKey);
          process.stdout.write("\n"); return resolve(typed);
        } else if (ch === "\u0003") process.exit(1);                 // Ctrl+C
        else if (ch === "\u0008" || ch === "\u007f") typed = typed.slice(0, -1); // Backspace
        else typed += ch;
      }
    };
    stdin.on("data", onKey);
    if (leftover) { const l = leftover; leftover = ""; onKey(l); }
  });
}
const users = arg("--users") || "100";

const steps = () => [
  { name: "Library availability", target: "availability query < 500 ms (p95)", file: "library/test-availability.js",
    args: ["--users", users, "--concurrency", "10"], keep: /p95|MET|filter:|boost :/ },
  { name: "Personal Insights", target: "100% match to the event log", file: "server/test-insights.js", args: [], keep: /match/ },
  { name: "Author Insights", target: "all numbers match the raw data", file: "server/test-author-insights.js", args: [], keep: /match/ },
  { name: "New book embedding", target: "same vector as the catalog", file: "server/test-book-embedding.js", args: [], keep: /MISMATCH|match|cosine/i },
  ...(email && password ? [{ name: "Signed-in API (end to end)", target: "all checks pass; new user gets 10 picks", file: "server/test-me-api.js",
    args: [email, password], keep: /passed|For You shelves|10 recommendations/ }] : []),
  ...(realEmail && realPassword ? [{ name: "Real account, read only", target: "For You correct + its load time with lots of data", file: "server/test-me-api.js",
    args: [realEmail, realPassword, "--read-only"], keep: /passed|ratings,|Top 10|For You shelves/ }] : []),
];

function run(step) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let out = "";
    const child = spawn(process.execPath, [path.join(ROOT, step.file), ...step.args], { cwd: ROOT });
    const take = (d) => { const t = hide(d); out += t; process.stdout.write(t); };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("close", (code) => resolve({ ...step, ok: code === 0, out, sec: Math.round((Date.now() - t0) / 1000) }));
  });
}

async function main() {
  if (email && !password) password = await askPassword(email);
  if (email && !password) console.log("No password typed - step 5 (signed-in API) is skipped. Nothing is written.");
  if (realEmail) realPassword = await askPassword(`${realEmail} (read only)`);
  if (realEmail && !realPassword) console.log("No password typed - step 6 (real account, read only) is skipped.");
  const results = [];
  for (const step of steps()) {
    console.log(`\n===== ${step.name}  (node ${step.file} ${hide(step.args.join(" "))})\n`);
    results.push(await run(step));
  }
  if (!email) console.log("\n(Step 5 skipped - add --email of the TEST account, with the server running.)");

  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `# BookBridge - final measurements, ${date}`, "",
    "| Test | Target | Result | Key lines |", "|---|---|---|---|",
    ...results.map((r) => {
      const key = r.out.split("\n").filter((l) => r.keep.test(l)).map((l) => l.trim()).slice(0, 4).join("<br>");
      return `| ${r.name} | ${r.target} | ${r.ok ? "PASS" : "FAIL"} | ${key.replace(/\|/g, "/")} |`;
    }),
    "", "Precision@10: see hybrid/evaluate.js (test set, 500 users).", "",
    ...results.flatMap((r) => [`## ${r.name} (${r.sec} s)`, "", "```", r.out.trim(), "```", ""]),
  ];
  fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
  const file = path.join(ROOT, "logs", `final-metrics-${date}.md`);
  fs.writeFileSync(file, lines.join("\n"));
  console.log(`\n===== Summary`);
  results.forEach((r) => console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}`));
  console.log(`\nSaved: ${path.relative(ROOT, file)}`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((err) => { console.error("Error:", err.message); process.exitCode = 1; });
