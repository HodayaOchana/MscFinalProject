const { test, expect } = require("@playwright/test");
const { mockApi, ask, BOOK } = require("./helpers");

const ADD = { type: "add_to_reading_list", bookId: 5, title: "The Hobbit" };

test.describe("confirmations", () => {
  test("nothing changes before the press, and Yes sends the change", async ({ page }) => {
    const { writes } = await mockApi(page, { answer: { actions: [ADD] } });
    await page.goto("/chat");
    await ask(page);
    await expect(page.getByText(/Add The Hobbit to your TBR\?/)).toBeVisible();
    expect(writes).toEqual([]);
    await page.getByRole("button", { name: "Yes, add it" }).click();
    await expect(page.getByText("✓ Added to your TBR")).toBeVisible();
    expect(writes).toEqual([{ method: "POST", url: "/api/me/events", body: { bookId: 5, type: "saved" } }]);
  });

  test("Not now changes nothing", async ({ page }) => {
    const { writes } = await mockApi(page, { answer: { actions: [ADD] } });
    await page.goto("/chat");
    await ask(page);
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByText(/Add The Hobbit to your TBR\?/)).toBeHidden();
    expect(writes).toEqual([]);
  });

  test("a review can be edited before it is published, and stars go first", async ({ page }) => {
    const { writes } = await mockApi(page, { answer: { actions: [{ type: "write_review", bookId: 5, title: "The Hobbit", text: "Charming", stars: 4 }] } });
    await page.goto("/chat");
    await ask(page);
    await page.getByLabel(/Your text/).fill("Charming, but slow");
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText(/Review published/)).toBeVisible();
    expect(writes).toEqual([
      { method: "POST", url: "/api/me/ratings", body: { bookId: 5, rating: 4, source: "chat" } },
      { method: "PUT", url: "/api/social/books/5/review", body: { body: "Charming, but slow" } },
    ]);
  });
});

test.describe("shortcuts under an answer", () => {
  test("one press adds a suggested book to the TBR", async ({ page }) => {
    const { writes } = await mockApi(page, { answer: { quickSave: [{ bookId: 9, title: "Real Murders" }] } });
    await page.goto("/chat");
    await ask(page);
    await page.getByRole("button", { name: /Real Murders/ }).click();
    await expect(page.getByText("✓ Real Murders")).toBeVisible();
    expect(writes[0]).toEqual({ method: "POST", url: "/api/me/events", body: { bookId: 9, type: "saved" } });
  });

  test("stars for the book asked about stay, then a review can follow", async ({ page }) => {
    const { writes } = await mockApi(page, { answer: { ratingOffer: { bookId: 7, title: "Dune", myRating: null } } });
    await page.goto("/chat");
    await ask(page);
    await page.getByRole("group", { name: "Rate Dune" }).getByRole("button", { name: "4 stars" }).click();
    await expect(page.getByText(/Rated/)).toBeVisible();
    await expect(page.getByRole("group", { name: "Rate Dune" }).getByRole("button", { name: "4 stars" })).toHaveAttribute("aria-pressed", "true");
    expect(writes[0].body).toEqual({ bookId: 7, rating: 4, source: "chat" });
    await page.getByRole("button", { name: "Add a review" }).click();
    await page.getByPlaceholder(/What did you think/).fill("Loved it");
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(page.getByText(/on the book’s page/)).toBeVisible();
    expect(writes[1]).toEqual({ method: "PUT", url: "/api/social/books/7/review", body: { body: "Loved it" } });
  });

  test("a rating round keeps the rated book, with its stars", async ({ page }) => {
    const { writes } = await mockApi(page, { answer: { ratingRound: true }, rateMore: [BOOK(1, "Book One"), BOOK(2, "Book Two")] });
    await page.goto("/chat");
    await ask(page);
    await page.getByRole("group", { name: "Rate Book One" }).getByRole("button", { name: "5 stars" }).click();
    await expect(page.getByText("✓ Saved")).toBeVisible();
    await expect(page.getByText("Book One")).toBeVisible();
    expect(writes[0].body).toEqual({ bookId: 1, rating: 5, source: "chat" });
    await page.getByRole("button", { name: "Haven’t read it" }).click();
    await expect(page.getByText("Book Two")).toBeHidden();
  });

  test("a card rated on the chat's shelf stays, with its stars", async ({ page }) => {
    const { writes } = await mockApi(page, { shelfBooks: [BOOK(3, "Shelf Book")], answer: {} });
    await page.goto("/chat");
    await ask(page);
    await page.getByRole("button", { name: "Rate this book" }).click();
    await page.getByRole("group", { name: "Rate Shelf Book" }).getByRole("button", { name: "3 stars" }).click();
    await expect(page.getByText("Yours")).toBeVisible();
    expect(writes[0].body).toEqual({ bookId: 3, rating: 3, source: "chat" });
  });
});

test.describe("asking about a book", () => {
  test("nothing is sent by itself, and an idea only fills the box", async ({ page }) => {
    const { chatPosts } = await mockApi(page);
    await page.goto("/chat?book=77");
    await expect(page.getByText(/You're asking about/)).toBeVisible();
    await page.getByRole("button", { name: "Is it for me?" }).click();
    await expect(page.getByPlaceholder(/Ask anything/)).toHaveValue(/Is “Mockingjay” for me\?/);
    expect(chatPosts).toEqual([]);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("An answer.")).toBeVisible();
    expect(chatPosts[0].bookId).toBe(77);
  });
});

test.describe("reading", () => {
  test("translating does not move the page", async ({ page }) => {
    await mockApi(page, { answer: { reply: "An answer.\n\n".repeat(30) }, shelfBooks: [BOOK(3, "Shelf Book")] });
    await page.goto("/chat");
    await ask(page);
    await expect(page.getByRole("button", { name: "Translate" })).toBeVisible();
    await page.waitForTimeout(800); // the scroll to the new answer ends
    await page.evaluate(() => window.scrollTo(0, 200));
    const before = await page.evaluate(() => window.scrollY);
    await page.getByRole("button", { name: "Translate" }).evaluate((b) => b.click());
    await page.getByRole("menuitem", { name: /Hebrew/ }).evaluate((b) => b.click());
    await expect(page.getByText("טקסט מתורגם")).toBeVisible();
    await page.waitForTimeout(500);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(5);
  });

  test("a page of the site is a link; another site's is not", async ({ page }) => {
    await mockApi(page, { answer: { reply: "See [My shelf](/shelf) and [this](https://evil.example/login)." } });
    await page.goto("/chat");
    await ask(page);
    await expect(page.getByRole("link", { name: "My shelf" })).toHaveAttribute("href", "/shelf");
    await expect(page.locator('a[href*="evil.example"]')).toHaveCount(0);
  });

  test("the start menu shows what the chat can do", async ({ page }) => {
    await mockApi(page);
    await page.goto("/chat");
    for (const label of ["What can you do here?", "Let me rate a few books", "What's on my reading list?"]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  });
});
