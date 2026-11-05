/**
 * Does search_books (the chatbot's retrieval) find the right book? Queries with a known
 * answer, without Claude - free and fast. Run it before and after a change to the search:
 *
 *   node server/eval-search.js              results: data/eval-search-results-<mode>.json
 *   CHAT_SEARCH=vector node server/eval-search.js     the search by meaning alone, to compare
 *
 * Two kinds of queries:
 *   description   a book's content in other words, no name from the book (search by meaning)
 *   exact         a word that must match: a character, a place, a rare term
 * Measures, with the chatbot's default 6 results:
 *   hit@1, hit@6  the book is first / in the results
 *   MRR           the average of 1 / its rank (0 when it is not found)
 *
 * The answers are hand-written, so this is a small sanity check, not a benchmark - and the
 * search was tuned while looking at it, so a good number here is not an unbiased estimate.
 */

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const hybrid = require(path.join(__dirname, "..", "hybrid", "hybrid-recommender"));
const db = hybrid.pool;
const tools = require("./chat-tools")({ db, recommendFor: async () => ({ recommendations: [] }) });

const COUNT = 6;
// [kind, query, the title (a regular expression) - any book of a series counts where it says so]
const CASES = [
  ["description", "a boy discovers he is a wizard and goes to a boarding school of magic", /^Harry Potter/i],
  ["description", "teenagers forced to fight to the death on live television", /Hunger Games/i],
  ["description", "a totalitarian state watches every citizen and rewrites history", /^1984|Nineteen Eighty/i],
  ["description", "a small home-loving creature joins dwarves on a quest to steal treasure from a dragon", /Hobbit/i],
  ["description", "a girl and a death narrator in Nazi Germany, she steals books", /Book Thief/i],
  ["description", "two teenagers with cancer fall in love and travel to meet an author", /Fault in Our Stars/i],
  ["description", "a shepherd boy travels to Egypt searching for treasure and his personal legend", /Alchemist/i],
  ["description", "a professor follows clues in paintings to a secret about the church", /Da Vinci Code/i],
  ["description", "a man is stranded alone on Mars and must grow potatoes to survive", /^The Martian/i],
  ["description", "a young woman marries a rich widower and is haunted by his dead first wife at their estate", /Rebecca/i],
  ["description", "a wealthy mysterious man throws lavish parties to win back his lost love in the 1920s", /Great Gatsby/i],
  ["description", "a lawyer in the American South defends a black man, seen through his daughter's eyes", /To Kill a Mockingbird/i],
  ["description", "a teenage boy leaves prep school and wanders New York feeling everyone is a phony", /Catcher in the Rye/i],
  ["description", "children evacuated to a country house find a wardrobe leading to a land of eternal winter", /Narnia|Lion, the Witch/i],
  ["description", "a desert planet, a noble family, giant worms and a precious spice", /^Dune/i],
  ["description", "a wife disappears on her anniversary and her husband becomes the suspect", /Gone Girl/i],
  ["description", "a hacker and a journalist investigate a decades old disappearance of a girl from a wealthy Swedish family", /Girl with the Dragon Tattoo/i],
  ["description", "a dog tells the story of his owner, a race car driver", /Art of Racing in the Rain/i],
  ["description", "a boy survives a shipwreck and shares a lifeboat with a tiger", /Life of Pi/i],
  ["description", "a girl falls in love with a vampire in a rainy town in Washington", /^Twilight/i],
  ["exact", "Katniss", /Hunger Games|Catching Fire|Mockingjay/i],
  ["exact", "Hogwarts", /Harry Potter/i],
  ["exact", "Frodo", /Lord of the Rings|Fellowship|Two Towers|Return of the King/i],
  ["exact", "Atticus Finch", /Mockingbird|Go Set a Watchman/i],
  ["exact", "Lisbeth Salander", /Girl (with|Who)/i],
  ["exact", "Hercule Poirot", /Poirot|Orient Express|Roger Ackroyd|Nile|Styles|Sad Cypress|Curtain|Five Little Pigs|ABC Murders|Evil Under the Sun/i],
  ["exact", "Sherlock Holmes", /Sherlock|Baskervilles/i],
  ["exact", "Mr. Darcy", /Pride and Prejudice|Darcy/i],
  ["exact", "Winterfell", /Game of Thrones|Clash of Kings|Storm of Swords|Feast for Crows|Dance with Dragons/i],
  ["exact", "Paul Atreides", /Dune/i],
  ["exact", "Robert Langdon", /Da Vinci|Angels|Lost Symbol|Inferno/i],
  ["exact", "Heathcliff", /Wuthering Heights/i],
  ["exact", "Jay Gatsby", /Gatsby/i],
  ["exact", "Hazel Grace", /Fault in Our Stars/i],
  ["exact", "Bilbo Baggins", /Hobbit/i],
  ["exact", "Aslan", /Narnia|Lion, the Witch|Prince Caspian|Dawn Treader|Silver Chair/i],
  ["exact", "Tris Prior", /Divergent|Insurgent|Allegiant/i],
  ["exact", "Edward Cullen", /Twilight|New Moon|Eclipse|Breaking Dawn|Midnight Sun/i],
  ["exact", "Percy Jackson", /Percy Jackson|Lightning Thief|Sea of Monsters|Titan|Labyrinth|Last Olympian/i],
  ["exact", "Tyrion Lannister", /Game of Thrones|Clash of Kings|Storm of Swords|Feast for Crows|Dance with Dragons/i],
];

(async () => {
  const mode = process.env.CHAT_SEARCH === "vector" ? "vector" : "hybrid";
  const ctx = { user: { id: 0 }, suggested: new Set() };
  const results = [];
  for (const [kind, query, answer] of CASES) {
    const started = Date.now();
    const { result } = await tools.run("search_books", { query, count: COUNT }, ctx);
    const titles = result.books.map((b) => b.title);
    const rank = titles.findIndex((t) => answer.test(t)) + 1;
    results.push({ kind, query, rank, ms: Date.now() - started, titles });
    if (!rank) console.log(`MISS  ${kind}: ${query}\n      got: ${titles.slice(0, 3).join(" | ")}`);
  }
  const score = (rows) => ({
    queries: rows.length,
    hitAt1: Number((rows.filter((r) => r.rank === 1).length / rows.length).toFixed(2)),
    hitAt6: Number((rows.filter((r) => r.rank > 0).length / rows.length).toFixed(2)),
    mrr: Number((rows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / rows.length).toFixed(2)),
  });
  const timed = results.slice(1).map((r) => r.ms).sort((a, b) => a - b); // the first one loads the model
  const summary = {
    mode,
    all: score(results),
    description: score(results.filter((r) => r.kind === "description")),
    exact: score(results.filter((r) => r.kind === "exact")),
    medianMs: timed[Math.floor(timed.length / 2)],
    p95Ms: timed[Math.floor(timed.length * 0.95)],
  };
  console.log(JSON.stringify(summary, null, 1));
  fs.writeFileSync(path.join(__dirname, "..", "data", `eval-search-results-${mode}.json`), JSON.stringify({ date: new Date().toISOString(), summary, results }, null, 2));
  await db.end();
})().catch((err) => { console.error(err); process.exit(1); });
