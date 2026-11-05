/**
 * The chatbot's tools (AI model 2) - the ONLY way the LLM learns about books.
 *
 * Every tool reads the BookBridge catalog (the same `books` table and pgvector
 * embeddings as model 1), so the chatbot can only talk about books that exist
 * here - it never recommends from its own memory (no hallucinated books).
 *
 *   search_books              free-text description -> embedding -> pgvector,
 *                             + filters: genres, pages, years, author, similar
 *                             to books, available in a library
 *   find_book                 a title the user names ("like Dune") -> book ids
 *   get_book_details          one book: full description, series, pages
 *   check_availability        where books are on the shelf (city / branch / near the reader)
 *   list_libraries            the branches, for "the central library in Jerusalem"
 *   recommend_for_me          model 1 (hybrid CF + CBF) from the user's saved
 *                             ratings and genres
 *   get_my_taste              the books the reader loved / disliked and the genres
 *                             they chose - for "is this book for me?"
 *
 * The query embedding uses the SAME model as the books (CBF/embed-books.js,
 * mpnet since 22/10/2026), so a description and a book are comparable.
 * First call downloads the model (~110 MB) - later calls take ~50 ms.
 *
 * "Near me": the page sends the reader's location with the message (only if they
 * pressed "Use my location"; it is not saved). Tools with near_me use it -
 * branches within radius_km (default 10), nearest first, as on For You.
 *
 * Every answer brings new books: search_books and recommend_for_me leave out the books
 * earlier answers suggested (ctx.suggested), unless the model passes include_suggested.
 *
 * Each tool returns small JSON (short descriptions) - the LLM reads it, and
 * the server remembers which book ids it saw (chat.js uses that to check
 * every book the answer mentions).
 */

const path = require("path");
const root = path.join(__dirname, "..");
const { GENRES, expandGenres, genreCondition } = require(path.join(root, "onboarding", "genres"));
const GENRE_LABEL = new Map(GENRES.map((g) => [g.key, g.label]));
const { parseNearby, getAvailability, NearbyError } = require(path.join(root, "library", "availability"));
const { loadSeries, diversify } = require(path.join(root, "hybrid", "diversity"));
const { CITIES } = require(path.join(root, "library", "libraries-data"));
const { addMatch } = require("./match"); // "92% match" on the cards
const { peekInfo } = require("./book-peek"); // the overall rating of a book (dataset + BookBridge readers)

// the same loaded model as new books (server/book-embedding.js) - one copy in memory
const { extractor: getExtractor, toVector } = require("./book-embedding");

const MAX_RESULTS = 10;
const POOL = 80;            // nearest books fetched before filters by availability / diversity
const SHORT_DESCRIPTION = 300;
const LONG_DESCRIPTION = 1500;

class ToolError extends Error {}

async function embed(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

const parseVector = (s) => (typeof s === "string" ? JSON.parse(s) : s);

function shorten(text, max) {
  if (!text) return null;
  const clean = String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

const yearOf = (date) => (date ? Number(String(date).slice(0, 4)) || null : null);

// The genre keys the user may ask for, in the words the LLM sees
const GENRE_KEYS = GENRES.map((g) => g.key);

function checkGenreKeys(keys, field) {
  if (keys === undefined || keys === null) return [];
  if (!Array.isArray(keys)) throw new ToolError(`${field} must be a list`);
  const unknown = keys.filter((k) => !GENRE_KEYS.includes(k));
  if (unknown.length) throw new ToolError(`unknown genre in ${field}: ${unknown.join(", ")} (use: ${GENRE_KEYS.join(", ")})`);
  return [...new Set(keys)];
}

function checkIds(ids, field, max = 20) {
  if (ids === undefined || ids === null) return [];
  if (!Array.isArray(ids)) throw new ToolError(`${field} must be a list of book ids`);
  const out = ids.map(Number);
  if (out.some((id) => !Number.isInteger(id) || id <= 0) || out.length > max) throw new ToolError(`bad ${field}`);
  return [...new Set(out)];
}

const DEFAULT_RADIUS_KM = 10;

// "where" for library availability: near the reader, branch names, or a city
async function libraryWhere(db, { city, library_names: names, near_me: nearMe, radius_km: radiusKm }, ctx = {}) {
  if (nearMe) {
    if (!ctx.location) {
      throw new ToolError("the reader has not shared a location - ask them to press \"Use my location\" under the chat, or to name a city or a branch");
    }
    const radius = Math.min(Math.max(Number(radiusKm) || DEFAULT_RADIUS_KM, 1), 50);
    return { where: parseNearby({ location: ctx.location, radiusKm: radius }), label: `branches within ${radius} km of the reader` };
  }
  if (names?.length) {
    const { rows } = await db.query(
      `SELECT id, name FROM libraries
       WHERE is_open AND EXISTS (SELECT 1 FROM unnest($1::text[]) n WHERE name ILIKE '%' || n || '%');`,
      [names.map(String)]
    );
    if (!rows.length) throw new ToolError(`no library matches ${names.join(", ")} - call list_libraries for the names`);
    return { where: parseNearby({ libraryIds: rows.map((r) => r.id) }), label: rows.map((r) => r.name).join(", ") };
  }
  if (city) {
    try {
      const where = parseNearby({ city });
      return { where, label: where.city };
    } catch (err) {
      if (err instanceof NearbyError) throw new ToolError(`${err.message}`);
      throw err;
    }
  }
  return null;
}

function availabilitySummary(a) {
  if (!a) return "not on the shelf there right now";
  const n = a.nearest;
  const dist = n.distanceKm === null ? "" : ` (${n.distanceKm} km away)`;
  const more = a.branchCount > 2 ? ` +${a.branchCount - 1} more branches` : a.branchCount === 2 ? " +1 more branch" : "";
  return `available at ${n.name}, ${n.city}${dist}${more}`;
}

// One book as the LLM sees it in a list
function bookLine(b, extra = {}) {
  return {
    id: b.id,
    title: b.title,
    authors: (b.authors || []).slice(0, 2),
    year: yearOf(b.published_date),
    pages: b.page_count || null,
    genres: b.main_genres?.length ? b.main_genres : (b.categories || []).slice(0, 3),
    series: b.series_name ? `${b.series_name} #${b.series_number ?? "?"}` : undefined,
    readers: b.ratings_count ? Number(b.ratings_count) : undefined,
    description: shorten(b.description, SHORT_DESCRIPTION),
    ...extra,
  };
}

const BOOK_COLUMNS = `b.id, b.title, b.authors, b.description, b.categories, b.main_genres,
  b.page_count, b.published_date, b.series_name, b.series_number::float8 AS series_number,
  b.thumbnail_url, p.ratings_count`;

// the books earlier answers suggested are left out (the model forgets to pass them in
// exclude_book_ids), unless it asks for them again with include_suggested
const withSuggested = (exclude, input, ctx) => (input.include_suggested === true || !ctx.suggested?.size
  ? exclude : [...new Set([...exclude, ...ctx.suggested])].slice(0, 400));

module.exports = function chatTools({ db, recommendFor }) {
  // ---------- search_books ----------
  async function searchBooks(input, ctx) {
    const query = String(input.query || "").trim().slice(0, 500);
    const similarTo = checkIds(input.similar_to_book_ids, "similar_to_book_ids", 5);
    if (!query && !similarTo.length) throw new ToolError("give a query, similar_to_book_ids, or both");
    const genres = checkGenreKeys(input.genres, "genres");
    const notGenres = checkGenreKeys(input.exclude_genres, "exclude_genres");
    const exclude = withSuggested(checkIds(input.exclude_book_ids, "exclude_book_ids", 200), input, ctx);
    const count = Math.min(Math.max(Number(input.count) || 6, 1), MAX_RESULTS);
    const library = await libraryWhere(db, input, ctx);
    if (library) ctx.where = library.where; // the area of this answer - chat.js draws its branches on a map

    // The search vector: the description, the books it should resemble, or both (average)
    const vectors = [];
    if (query) vectors.push(await embed(query));
    if (similarTo.length) {
      const { rows } = await db.query(`SELECT id, embedding FROM books WHERE id = ANY($1::int[]) AND embedding IS NOT NULL;`, [similarTo]);
      if (!rows.length) throw new ToolError("none of similar_to_book_ids is in the catalog");
      vectors.push(...rows.map((r) => parseVector(r.embedding)));
    }
    const mean = vectors[0].map((_, i) => vectors.reduce((s, v) => s + v[i], 0) / vectors.length);

    const params = [toVector(mean), [...exclude, ...similarTo]];
    const where = ["b.embedding IS NOT NULL", "b.language = 'en'", "NOT (b.id = ANY($2::int[]))"];
    const add = (value) => { params.push(value); return `$${params.length}`; };
    if (genres.length) {
      const { goodreads, google } = expandGenres(genres);
      where.push(genreCondition(add(goodreads), add(google)));
    }
    if (notGenres.length) {
      const { goodreads, google } = expandGenres(notGenres);
      where.push(`NOT ${genreCondition(add(goodreads), add(google))}`);
      where.push(`NOT coalesce(b.main_genres && ${add(goodreads)}::text[], false)`);
    }
    if (input.max_pages) where.push(`b.page_count <= ${add(Number(input.max_pages))}::int`);
    if (input.min_pages) where.push(`b.page_count >= ${add(Number(input.min_pages))}::int`);
    if (input.published_after) where.push(`left(b.published_date, 4) ~ '^\\d{4}$' AND left(b.published_date, 4)::int >= ${add(Number(input.published_after))}::int`);
    if (input.published_before) where.push(`left(b.published_date, 4) ~ '^\\d{4}$' AND left(b.published_date, 4)::int <= ${add(Number(input.published_before))}::int`);
    if (input.author) where.push(`EXISTS (SELECT 1 FROM unnest(b.authors) a WHERE a ILIKE '%' || ${add(String(input.author))} || '%')`);

    const { rows } = await db.query(
      `SELECT ${BOOK_COLUMNS}, 1 - (b.embedding <=> $1::vector) AS similarity
       FROM books b LEFT JOIN book_popularity p ON p.book_id = b.id
       WHERE ${where.join(" AND ")}
       ORDER BY b.embedding <=> $1::vector
       LIMIT ${POOL};`,
      params
    );

    // one book per series, at most 2 per author, no other edition of a book given as an example
    const { rows: base } = similarTo.length ? await db.query(`SELECT title FROM books WHERE id = ANY($1::int[]);`, [similarTo]) : { rows: [] };
    const { seriesOf } = await loadSeries(db, rows.map((r) => r.id));
    let books = diversify(rows, { seriesOf, skipTitles: base.map((b) => b.title) });

    let availability = null;
    if (library) {
      availability = await getAvailability(db, books.map((b) => b.id), library.where);
      books = books.filter((b) => availability.has(b.id));
    }
    books = addMatch(books.slice(0, count), (b) => b.similarity);
    return {
      books: books.map((b) => bookLine(b, {
        match: b.match, // % of the best result's similarity
        ...(availability ? { availability: availabilitySummary(availability.get(b.id)) } : {}),
      })),
      ...(library ? { library: library.label, inventorySimulated: true } : {}),
      note: books.length ? undefined : "nothing matched - try fewer filters or other words",
    };
  }

  // ---------- find_book ----------
  async function findBook(input) {
    const title = String(input.title || "").trim().slice(0, 200);
    if (title.length < 2) throw new ToolError("title is required");
    const params = [title];
    let byAuthor = "";
    if (input.author) { params.push(String(input.author)); byAuthor = `AND EXISTS (SELECT 1 FROM unnest(b.authors) a WHERE a ILIKE '%' || $2 || '%')`; }
    const { rows } = await db.query(
      `SELECT ${BOOK_COLUMNS}
       FROM books b LEFT JOIN book_popularity p ON p.book_id = b.id
       WHERE b.title ILIKE '%' || $1 || '%' ${byAuthor}
       ORDER BY (lower(b.title) = lower($1)) DESC, p.ratings_count DESC NULLS LAST, length(b.title)
       LIMIT 5;`,
      params
    );
    return rows.length
      ? { books: rows.map((b) => bookLine(b)) }
      : { books: [], note: "not in the BookBridge catalog - say so, and offer to search by description instead" };
  }

  // ---------- get_book_details ----------
  async function getBookDetails(input) {
    const [id] = checkIds([input.book_id], "book_id");
    const { rows } = await db.query(
      `SELECT ${BOOK_COLUMNS}, b.publisher FROM books b LEFT JOIN book_popularity p ON p.book_id = b.id WHERE b.id = $1;`,
      [id]
    );
    if (!rows[0]) throw new ToolError(`no book ${id} in the catalog`);
    const b = rows[0];
    const peek = (await peekInfo(db, [id])).get(id);
    return {
      ...bookLine(b),
      description: shorten(b.description, LONG_DESCRIPTION),
      publisher: b.publisher || undefined,
      categories: b.categories || [],
      readersRating: peek?.avgRating != null ? `${peek.avgRating} / 5 from ${peek.ratingCount} ratings` : "no ratings yet",
    };
  }

  // ---------- get_my_taste ----------
  async function getMyTaste(input, ctx) {
    const [{ rows: rated }, { rows: genres }] = await Promise.all([
      db.query(
        `SELECT b.id, b.title, b.authors, b.main_genres, b.categories, r.rating
         FROM user_ratings r JOIN books b ON b.id = r.book_id
         WHERE r.user_id = $1 ORDER BY r.rating DESC, r.updated_at DESC NULLS LAST;`,
        [ctx.user.id]
      ),
      db.query(`SELECT genre_key FROM user_genres WHERE user_id = $1;`, [ctx.user.id]),
    ]);
    const line = (b) => ({ id: b.id, title: b.title, authors: (b.authors || []).slice(0, 1), stars: b.rating, genres: b.main_genres?.length ? b.main_genres : (b.categories || []).slice(0, 2) });
    return {
      chosenGenres: genres.map((g) => GENRE_LABEL.get(g.genre_key) || g.genre_key),
      ratedBooks: rated.length,
      books: [
        ...rated.filter((b) => b.rating >= 4).slice(0, 15).map(line),
        ...rated.filter((b) => b.rating <= 2).slice(0, 5).map(line),
      ],
      note: rated.length ? "books = what the reader loved (4-5 stars), then what they disliked (1-2 stars)" : "the reader has not rated books yet - only their chosen genres are known",
    };
  }

  // ---------- check_availability ----------
  async function checkAvailability(input, ctx) {
    const ids = checkIds(input.book_ids, "book_ids", 10);
    if (!ids.length) throw new ToolError("book_ids is required");
    const library = await libraryWhere(db, input, ctx);
    if (library) ctx.where = library.where; // the area of this answer - chat.js draws its branches on a map
    const where = library?.where || { lat: null, lng: null, radiusKm: null, city: null, libraryIds: null };
    const avail = await getAvailability(db, ids, where);
    const { rows } = await db.query(`SELECT id, title FROM books WHERE id = ANY($1::int[]);`, [ids]);
    return {
      where: library?.label || "all branches",
      books: rows.map((b) => {
        const a = avail.get(b.id);
        return {
          id: b.id,
          title: b.title,
          available: Boolean(a),
          branches: a ? a.branches.map((x) => `${x.name}, ${x.city} (${x.copiesAvailable} of ${x.copiesTotal} copies${x.distanceKm === null ? "" : `, ${x.distanceKm} km away`})`) : [],
          moreBranches: a && a.branchCount > a.branches.length ? a.branchCount - a.branches.length : undefined,
        };
      }),
      inventorySimulated: true,
    };
  }

  // ---------- list_libraries ----------
  async function listLibraries(input) {
    const params = [];
    let where = "WHERE is_open";
    if (input.city) {
      const city = parseNearby({ city: input.city }).city;
      params.push(city);
      where += " AND city = $1";
    }
    const { rows } = await db.query(`SELECT name, city, address FROM libraries ${where} ORDER BY city, name;`, params);
    return { libraries: rows };
  }

  // ---------- recommend_for_me ----------
  async function recommendForMe(input, ctx) {
    const count = Math.min(Math.max(Number(input.count) || 6, 1), MAX_RESULTS);
    const exclude = withSuggested(checkIds(input.exclude_book_ids, "exclude_book_ids", 200), input, ctx);
    const library = await libraryWhere(db, input, ctx);
    if (library) ctx.where = library.where; // the area of this answer - chat.js draws its branches on a map
    const w = library?.where;
    const nearby = !w ? undefined
      : w.lat !== null ? { location: { lat: w.lat, lng: w.lng }, radiusKm: w.radiusKm }
      : w.libraryIds ? { libraryIds: w.libraryIds } : { city: w.city };
    const result = await recommendFor(ctx.user.id, count, nearby, exclude);
    const ids = result.recommendations.map((r) => r.id);
    const { rows } = await db.query(
      `SELECT ${BOOK_COLUMNS} FROM books b LEFT JOIN book_popularity p ON p.book_id = b.id WHERE b.id = ANY($1::int[]);`,
      [ids]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      basedOn: result.cfWeight > 0 ? "the user's saved ratings and chosen genres" : "the user's chosen genres (no ratings yet - popular books in those genres)",
      books: result.recommendations.filter((r) => byId.has(r.id)).map((r) => bookLine(byId.get(r.id), {
        why: r.reasonText,
        match: r.match,
        ...(r.availabilityText ? { availability: r.availabilityText } : {}),
      })),
      ...(library ? { library: library.label, inventorySimulated: true } : {}),
    };
  }

  const libraryProps = {
    near_me: { type: "boolean", description: "Only books on the shelf in branches near the reader (\"near me\", \"close to home\"). Works only if the reader shared their location." },
    radius_km: { type: "integer", minimum: 1, maximum: 50, description: `With near_me: how far, in km (default ${DEFAULT_RADIUS_KM}).` },
    city: { type: "string", enum: CITIES, description: "Only books on the shelf in this city's public libraries." },
    library_names: {
      type: "array", items: { type: "string" }, maxItems: 5,
      description: "Only books on the shelf in these branches (part of the name is enough, e.g. \"Beit Ha'am\"). Use list_libraries for the names.",
    },
  };

  const definitions = [
    {
      name: "search_books",
      description:
        "Search the BookBridge catalog by meaning: a free-text description of the book the user wants is turned into an embedding and compared with every book's embedding (pgvector). " +
        "Use it for almost every request. Write `query` in ENGLISH, as a short description of the wanted book's content, mood and themes (e.g. \"epic desert planet politics, female protagonist, hopeful tone\") - not as instructions. " +
        "To find books like ones the user named, call find_book first and pass their ids in similar_to_book_ids (alone, or together with a query to steer). " +
        "Filters are exact - use them only for hard constraints the user stated. Returns up to 10 books with a short description and a match percent (relative to the best result).",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "English description of the wanted content, mood, themes, setting, protagonist." },
          similar_to_book_ids: { type: "array", items: { type: "integer" }, maxItems: 5, description: "Catalog ids of books the result should resemble." },
          genres: { type: "array", items: { type: "string", enum: GENRE_KEYS }, description: "Only books in at least one of these genres." },
          exclude_genres: { type: "array", items: { type: "string", enum: GENRE_KEYS }, description: "No books in these genres (e.g. \"not horror\")." },
          max_pages: { type: "integer", minimum: 20 },
          min_pages: { type: "integer", minimum: 1 },
          published_after: { type: "integer", description: "Year, inclusive." },
          published_before: { type: "integer", description: "Year, inclusive." },
          author: { type: "string", description: "Only books by this author (part of the name)." },
          exclude_book_ids: { type: "array", items: { type: "integer" }, description: "Books the reader rejected. Books suggested in earlier answers are left out automatically." },
          include_suggested: { type: "boolean", description: "true only when the reader asks to see earlier suggestions again (e.g. \"which of those is shortest?\"). Default: they are left out." },
          count: { type: "integer", minimum: 1, maximum: 10, description: "How many books (default 6)." },
          ...libraryProps,
        },
      },
    },
    {
      name: "find_book",
      description: "Look up a book the user names, by title (and optionally author), to get its catalog id - for \"something like X\", \"tell me about X\", \"is X in the library\". Returns up to 5 matches; empty if the book is not in the catalog.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "The title in English (translate a Hebrew title to its English edition's title)." },
          author: { type: "string" },
        },
        required: ["title"],
      },
    },
    {
      name: "get_book_details",
      description: "The full description and details of one catalog book, with how readers rate it. Use it before claiming anything about a book that the short description does not say (e.g. the protagonist, the ending's tone), and for an opinion on a book.",
      input_schema: { type: "object", properties: { book_id: { type: "integer" } }, required: ["book_id"] },
    },
    {
      name: "check_availability",
      description: "Where catalog books are on the shelf right now in the public libraries (Jerusalem and Tel Aviv-Yafo), nearest first with near_me. Without near_me / city / library_names: all branches. The inventory is simulated for now.",
      input_schema: {
        type: "object",
        properties: { book_ids: { type: "array", items: { type: "integer" }, maxItems: 10 }, ...libraryProps },
        required: ["book_ids"],
      },
    },
    {
      name: "list_libraries",
      description: "The public library branches BookBridge knows (name, city, address).",
      input_schema: { type: "object", properties: { city: { type: "string", enum: CITIES } } },
    },
    {
      name: "get_my_taste",
      description:
        "What THIS reader likes: the books they loved (4-5 stars) and disliked (1-2 stars) on BookBridge, and the genres they chose. " +
        "Use it to say whether a book is for them (\"is it for me?\", \"would I like it?\") - compare the book with the books they loved and disliked.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "recommend_for_me",
      description:
        "Personal recommendations from BookBridge's recommendation engine (hybrid collaborative filtering + content-based), built from the books THIS user rated and the genres they chose. " +
        "Use it when the user asks what to read next without describing a book (\"surprise me\", \"what should I read?\"), or wants picks based on their taste. Each book says why it was picked.",
      input_schema: {
        type: "object",
        properties: {
          count: { type: "integer", minimum: 1, maximum: 10 },
          exclude_book_ids: { type: "array", items: { type: "integer" } },
          include_suggested: { type: "boolean", description: "true only to see earlier suggestions again." },
          ...libraryProps,
        },
      },
    },
  ];

  const handlers = {
    search_books: searchBooks,
    find_book: findBook,
    get_book_details: getBookDetails,
    check_availability: checkAvailability,
    list_libraries: listLibraries,
    recommend_for_me: recommendForMe,
    get_my_taste: getMyTaste,
  };

  /**
   * Runs one tool. Returns { result, books } - books = every catalog book in the
   * result, with what its card can show: { id, why?, availabilityText? }
   */
  async function run(name, input, ctx) {
    const handler = handlers[name];
    if (!handler) throw new ToolError(`unknown tool ${name}`);
    const result = await handler(input || {}, ctx);
    const books = [];
    const collect = (b) => {
      if (!b || !Number.isInteger(b.id)) return;
      const card = { id: b.id };
      if (b.why) card.why = b.why;
      if (Number.isInteger(b.match)) card.match = b.match;
      if (typeof b.availability === "string" && b.availability.startsWith("available at ")) {
        card.availabilityText = `Available at ${b.availability.slice("available at ".length)}`;
      } else if (b.available && b.branches?.length) {
        card.availabilityText = `Available at ${b.branches[0].replace(/ \(.*\)$/, "")}`;
      }
      books.push(card);
    };
    if (Array.isArray(result.books)) result.books.forEach(collect);
    else collect(result);
    return { result, books };
  }

  return { definitions, run, embed, getExtractor };
};

module.exports.ToolError = ToolError;
module.exports.GENRE_KEYS = GENRE_KEYS;
module.exports.helpers = { checkIds, withSuggested }; // for test/chat-tools.test.js
