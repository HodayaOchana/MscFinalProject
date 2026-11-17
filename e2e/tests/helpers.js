// The API, mocked: what the chat answers, and a record of what the page tried to change
const BOOK = (id, title) => ({ id, title, authors: ["An Author"], thumbnail_url: null, reasonText: `Why ${title} fits` });

async function mockApi(page, { answer = {}, shelfBooks = [], rateMore = [] } = {}) {
  const writes = [];
  const chatPosts = [];
  const record = async (route) => {
    const req = route.request();
    writes.push({ method: req.method(), url: new URL(req.url()).pathname, body: req.postDataJSON() });
    await route.fulfill({ json: { ok: true, id: 1, note: "saved" } });
  };
  await page.route("**/api/me/events", record);
  await page.route("**/api/me/ratings/*", record);
  await page.route("**/api/social/**", record);
  await page.route("**/api/me/genres", record);
  await page.route("**/api/me/ratings", (route) => (route.request().method() === "GET" ? route.fulfill({ json: { ratings: [] } }) : record(route)));
  await page.route("**/api/me/rate-more", (route) => route.fulfill({ json: { genres: ["fantasy"], books: rateMore } }));
  await page.route("**/api/books/*", (route) => route.fulfill({ json: BOOK(77, "Mockingjay") }));
  await page.route("**/api/chat/translate", async (route) => {
    await new Promise((ok) => setTimeout(ok, 300));
    await route.fulfill({ json: { text: "טקסט מתורגם" } });
  });
  await page.route("**/api/chat/memory", (route) => (route.request().method() === "GET" ? route.fulfill({ json: { notes: [] } }) : record(route)));
  await page.route(/\/api\/chat$/, async (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { conversations: [] } });
    chatPosts.push(req.postDataJSON());
    const done = { conversationId: "00000000-0000-4000-8000-000000000001", title: "Test", reply: "An answer.", followUps: [], actions: [], quickSave: [], ratingOffer: null, ratingRound: false, books: shelfBooks, places: null, grounding: { mentioned: 0, ungrounded: 0 }, ...answer };
    return route.fulfill({ contentType: "text/event-stream", body: `event: done\ndata: ${JSON.stringify(done)}\n\n` });
  });
  return { writes, chatPosts };
}

async function ask(page, text = "A question") {
  await page.getByPlaceholder(/What are you in the mood|Ask anything/).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

module.exports = { mockApi, ask, BOOK };
