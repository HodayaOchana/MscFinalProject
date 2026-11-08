# BookBridge API

The REST API of the BookBridge server (`server/server.js`, Node.js + Express).
The website (Next.js, `web/`) talks only to this API; the API talks to PostgreSQL (Neon) and
to the recommendation code (`hybrid/`, `CBF/`, `CF/`, `library/`).

- **Base URL (development):** `http://localhost:3001` (`PORT` in `.env`)
- **Format:** JSON in, JSON out (`Content-Type: application/json`, body up to 100 KB)
- **Run:** `node server/server.js` - check with `GET /api/health`

## Contents

1. [Conventions](#1-conventions) - login, errors, common objects
2. [Public](#2-public-no-login) - health, questionnaire, search, books, series, libraries, guest recommendations
3. [Signed-in user `/api/me`](#3-signed-in-user--apime) - profile, ratings, shelves, recommendations, For You, insights, searches, views
4. [Social `/api/social`](#4-reviews-and-discussion--apisocial) - reviews and discussion
5. [Authors](#5-authors) - author pages, publisher confirmation, claims, new books
6. [Admin `/api/admin`](#6-admin--apiadmin) - the project team
7. [Data rules that hold for every route](#7-data-rules-that-hold-for-every-route)

---

## 1. Conventions

### Login

Routes marked **🔒** need a Neon Auth login token:

```
Authorization: Bearer <JWT from Neon Auth>
```

The server checks the token's signature against Neon Auth's public keys (`server/auth.js`).
The user is identified **only** by the token - never by an id in the address or the body - so a
user can never read or change another user's data. On a user's first request the app profile
(`users` row) is created.

| Situation | Status | Body |
|---|---|---|
| no token | 401 | `{ "error": "login required" }` |
| bad / expired token | 401 | `{ "error": "invalid or expired token - sign in again", "reason": "expired" \| "invalid" \| "keys-unreachable" }` |
| signed in, but not allowed (admin pages) | 403 | `{ "error": "...", "signedInAs": "<own email>" }` |

### Errors

Every error is `{ "error": "<message for people>" }`.

| Status | When |
|---|---|
| 400 | bad input - the message says what (e.g. `"bad book id"`, `"choose 1-5 genres"`) |
| 401 / 403 | see Login |
| 404 | the thing does not exist (`"book not found"`), or an unknown address (`"no such address"`) |
| 409 | a conflict (e.g. a book still referred to by other data) |
| 500 | `{ "error": "server error" }` - details only in the server log |

Input is always checked on the server ("never trust what the browser sends"): ids are positive
integers, genres must be keys from `onboarding/genres.js`, ratings 1-5, text lengths limited.

### Common objects

**Book (in lists)**

```json
{
  "id": 1935, "title": "The Hobbit", "authors": ["J.R.R. Tolkien"],
  "thumbnail_url": "https://...", "goodbooks_id": 7,
  "blurb": "In a hole in the ground there lived a hobbit...",   // hover card (server/book-peek.js)
  "avgRating": 4.25, "ratingCount": 4012                         // hover card: goodbooks + BookBridge ratings
}
```

**Recommended book** = Book + why it was picked:

```json
{
  "...book fields": "...",
  "score": 0.83,
  "reason": "Readers with similar taste liked it (CF)", // the source: (CF) collaborative, (CBF) content, or popularity
  "reasonText": "Readers with similar taste liked it", // text to show
  "series": { "name": "Twilight", "number": 2, "more": 2 },          // when the book is in a series
  "availability": { "nearest": { "name": "Gilo Library", "distanceKm": 2.3 }, "branchCount": 3 },
  "availabilityText": "Available at Gilo Library (2.3 km) and 2 more branches"  // only when a library filter was asked
}
```

**Library filter** (`nearby`) - optional on every recommendation route:

| As JSON body | As query string | Meaning |
|---|---|---|
| `{ "location": { "lat": 31.77, "lng": 35.21 }, "radiusKm": 10 }` | `?lat=31.77&lng=35.21&radiusKm=10` | branches within the radius (default 10, max 50 km) |
| `{ "city": "Jerusalem" }` | `?city=Jerusalem` | branches in a city (Hebrew / English names) |
| `{ "libraryIds": [1, 2] }` | - | chosen branches |
| `"mode": "filter"` (default) | `&mode=filter` | only books on the shelf nearby |
| `"mode": "boost"` | `&mode=boost` | books on the shelf nearby first |

The library inventory is **simulated** (`library/simulate-inventory.js`); answers say `"inventorySimulated": true`.

---

## 2. Public (no login)

### `GET /api/health`
The server is up and the database answers. → `{ "ok": true }`

### `GET /api/onboarding/questionnaire`
The sign-up questionnaire: screens, texts, the genre list. → the `QUESTIONNAIRE` object (`onboarding/questionnaire.js`).

### `POST /api/onboarding/books`
About 20 well-known books from the chosen genres, to rate in the questionnaire.

```json
{ "genres": ["fantasy", "mystery-crime"] }          // 1-5 genre keys
```
→ `{ "books": [Book, ...] }`

### `POST /api/recommendations`  (also `POST /api/onboarding/submit`)
Recommendations from ratings sent **in the request** - for guests and tests. Signed-in users use `GET /api/me/recommendations`.

```json
{
  "genres": ["fantasy"],
  "answers": [{ "bookId": 1935, "stars": 5 }, { "bookId": 1931, "stars": null }],  // null = "haven't read"
  "count": 10,                                                                      // 1-30
  "nearby": { "city": "Jerusalem", "mode": "boost" }                                // optional
}
```
`ratings: [{ bookId, rating }]` may be sent instead of `answers` (up to 1000).

→
```json
{
  "cfWeight": 0.38,                       // how much the collaborative part counts (more ratings -> more)
  "cfModel": "EASE 0.85 + ALS 0.15",
  "genres": ["fantasy"],
  "recommendations": [RecommendedBook, ...]
}
```

### `GET /api/books/search?q=...`
Search the catalog (up to 30 books).

| `q` | Searches |
|---|---|
| `harry`, `rowling`, `j k rowling` | title, or author (punctuation and spaces ignored); title matches first, then better-known books |
| `#dystopian`, `#coming of age` | books readers tagged so (`book_reader_tags`); exact tag, else tags starting with it |

→ `{ "mode": "text" | "tag", "tag": "dystopian", "books": [Book + { "match": "title" | "author" | "tag", "tag_count": 412 }] }`
400 if fewer than 2 letters.

### `GET /api/books/tags?q=dys`
Tag suggestions while typing `#...` (8 at most; `q` empty = the most used). → `{ "tags": [{ "tag": "dystopian", "books": 412 }] }`

### `GET /api/books/:id`
One book. → Book + `description`, `categories`, `main_genres`, `published_date`, `page_count`, `ratings_count`, `liked_count`,
`series: { name, number, total } | null`, `authorAccounts: [...]` (linked author pages), `readerTags: ["fantasy", ...]`. 404 if none.

### `GET /api/books/:id/similar?count=6&offset=0`
"Similar in spirit" (content-based). Varied: one book per series, at most 2 per author, no guides or companions *about* the book. Up to 30 in all, paged.
→ `{ "books": [Book + { "score" }], "hasMore": true }`

### `GET /api/series?name=Harry%20Potter`
All books of a series in order, then box sets. → `{ "name", "author", "books": [Book + { "number" }], "collections": [...] }`. 404 if unknown.

### `GET /api/libraries?city=Jerusalem`
Open library branches (all, or in a city). → `{ "libraries": [{ "id", "name", "city", "address", "lat", "lng" }], "inventorySimulated": true }`

### `GET /api/books/:id/availability?city=...` (or `?lat=&lng=&radiusKm=`)
Where a book is on the shelf. → `{ "bookId", "availability": {...} | null, "availabilityText", "inventorySimulated": true }`

---

## 3. Signed-in user - `/api/me`  🔒

All routes here act on **the token's user only** (`server/me-routes.js`).

### Profile and preferences

| Route | Body | Answer |
|---|---|---|
| `GET /api/me` | - | `{ id, name, email, userType, libraryId, preferredCity, onboarded, genres: [...], ratingsCount }` |
| `PATCH /api/me` | `{ "preferredCity": "Jerusalem" }` | `{ ok, preferredCity }` |
| `PUT /api/me/genres` | `{ "genres": ["fantasy", "romance"] }` (1-5) | `{ ok, genres }` |
| `POST /api/me/onboarding` | `{ "genres": [...], "answers": [{ bookId, stars }] }` | saves the questionnaire → `{ saved: { genres, ratings }, ...10 recommendations }` |
| `GET /api/me/consents` | - | `{ needed, required, versions, current: { terms, privacy, age_16, research } }` |
| `POST /api/me/consents` | `{ terms, privacy, age16, research, source }` - only the keys sent | `{ ok, needed, current }` |

### Ratings and shelves

| Route | Body | Answer |
|---|---|---|
| `GET /api/me/ratings` | - | `{ ratings: [{ bookId, rating, source, updatedAt, title, authors, thumbnail_url }] }` newest first; `source` = `onboarding` \| `app` |
| `POST /api/me/ratings` | `{ bookId, rating }` or `{ ratings: [{ bookId, rating }] }` (1-5) | `{ ok, saved }` |
| `DELETE /api/me/ratings/:bookId` | - | `{ ok, deleted }` |
| `POST /api/me/rate-more` | `{ "skip": [ids] }` | ~20 books from the user's genres, not rated yet → `{ genres, books }` |
| `POST /api/me/events` | `{ bookId, type }` - `saved` \| `unsaved` \| `started` \| `finished` \| `dismissed` \| `clicked` | `{ ok }` |
| `GET /api/me/shelf` | - | `{ saved: [Book], finished: [Book] }` - `saved` = the TBR list |

### Recommendations

#### `GET /api/me/recommendations`
From the **saved** ratings, genres and activity (searches, finished, TBR feed the model; "Not for me" books never come back).

Query: `?count=10` · `&exclude=1,2,3` (books already shown - "Recommend more" gives 10 *new* ones) · library filter (section 1).
→ same shape as `POST /api/recommendations`.

#### `GET /api/me/recommendations/rows`
The whole **For You** page in one call (library filter allowed).

```json
{
  "cfModel": "EASE 0.85 + ALS 0.15",
  "genres": ["fantasy", "romance"],
  "top":   [RecommendedBook x 10],                       // Top 10
  "fresh": [                                             // change at once with what the user does (server/fresh-rows.js)
    { "key": "series", "label": "Continue your series", "subtitle": "...", "books": [...] },
    { "key": "looked", "label": "Because you looked at Dune", "anchor": { "id": 9853, "title": "Dune" }, "books": [...] }
  ],
  "rows": [                                              // one shelf per genre, the user's genres first, then "more"
    { "key": "fantasy", "label": "Fantasy", "chosen": true, "books": [...] }
  ]
}
```

- **Continue your series** - the next unread books (by series number) of series the user rated 3★+ or finished; up to 2 per series, most recently active series first.
- **Because you looked at X** - X = a book opened at least twice in 30 days, or opened from a search, that the user has not rated / hidden; books like it ("readers who liked it" via EASE, then similar content).
- No book appears twice on the page, and no rated / finished / hidden book appears at all.

### Activity

| Route | Body | Answer |
|---|---|---|
| `GET /api/me/searches` | - | `{ searches: [{ query, at, count }] }` - the last 8 |
| `POST /api/me/searches` | `{ query, resultsCount, topBookIds }` | `{ id, count }` - a search with 0 results is not saved (`{ id: null, skipped }`) |
| `POST /api/me/searches/:id/click` | `{ bookId }` - the result opened | `{ ok }` |
| `DELETE /api/me/searches?query=harry` / `DELETE /api/me/searches` | - | `{ deleted }` - one search / all |
| `POST /api/me/book-views` | `{ bookId }` - sent after the book page was on screen 8 s | `{ counted, views }` - counted again only after 30 min; 200 books kept per user |

### Insights

| Route | Answer |
|---|---|
| `GET /api/me/insights` | personal reading analytics: totals, star histogram, genres, monthly activity (12 months), ... - computed from the raw rows on every call (`server/insights.js`) |

### Being an author

| Route | Body | Answer |
|---|---|---|
| `GET /api/me/author` | - | `{ isAuthor, books, userId, request, profile, ... }` |
| `POST /api/me/author-request` | `{ penName, books, publisherName, publisherEmail, message, confirm: true }` | "I am an author" - the publisher gets a confirmation email → `{ ok, emailed }` |
| `POST /api/me/author-request/resend` | - | a new confirmation email (once a day) |
| `PUT /api/me/author/profile` | `{ penName, bio, website }` | the public author page (authors only) |
| `GET /api/me/author/insights` | - | how readers respond to the author's books - counts only, never who (`server/author-insights.js`) |
| `GET /api/me/author/insights/audience?book=<id>\|all` | - | genres of the readers who loved it, books they also loved (shown only with enough readers) |

---

## 4. Reviews and discussion - `/api/social`  🔒

`server/social-routes.js`. Other users see "First L." - never an email. Text is stored as typed and shown as plain text.
Limits: 2000 characters, 30 posts per user per hour.

| Route | Body | Notes |
|---|---|---|
| `GET /api/social/books/:id` | - | the book's reviews and discussion, and what this user may do |
| `PUT /api/social/books/:id/review` | `{ body }` | write / edit your review - you must rate the book first |
| `DELETE /api/social/books/:id/review` | - | delete your review |
| `POST /api/social/books/:id/posts` | `{ body, parentId? }` | a post, or a reply to one |
| `DELETE /api/social/posts/:postId` | - | your own post (its replies go with it) |
| `POST /api/social/posts/:postId/pin` | `{ pinned }` | authors of the book only; one pinned post per book |

---

## 5. Authors

### Author pages - `/api/authors`  🔒
`GET /api/authors/:userId` → `{ userId, penName, bio, website, books, isMe }`. Only what the author chose to show - never the account email or real name. 404 if the account is not linked to any book.

### The publisher confirms an author - `/api/publisher` (no login)
The publisher gets an emailed link (`server/author-verification.js`). Opening the link decides nothing; a button does.

| Route | Body | Notes |
|---|---|---|
| `GET /api/publisher/request?token=...` | - | what the publisher is asked to confirm |
| `POST /api/publisher/decision` | `{ token, decision: "confirm" \| "decline" }` | once per link |

The token is 256 random bits; only its SHA-256 is stored; it expires after 7 days and works once.
Publisher emails must be on `PUBLISHER_EMAILS`.

### Verified authors - `/api/author`  🔒

| Route | Body | Notes |
|---|---|---|
| `GET /api/author/search?q=...` | - | catalog search for "This is my book" → `{ books: [Book + { matchesYou }] }` |
| `POST /api/author/claims` | `{ bookId, message? }` | linked at once if the book's author is one of your verified names; otherwise a claim for the team |
| `POST /api/author/books` | `{ title, authors, description, genres, publishedDate, ... }` | a new book - live at once, with its embedding and similar books; must list your verified name as an author |

---

## 6. Admin - `/api/admin`  🔒 + project team

Only signed-in users whose email is on `ADMIN_EMAILS` (`server/admin-routes.js`); anyone else gets 403.

| Route | Body | Notes |
|---|---|---|
| `GET /api/admin/summary` | - | for the header bell: `{ admin, pendingBookClaims, waitingForPublisher }` (non-admins: `{ admin: false }`, no 403) |
| `GET /api/admin/me` | - | `{ admin: true }` |
| `GET /api/admin/author-requests?status=pending\|all` | - | author requests and the publisher's answer |
| `POST /api/admin/author-requests/:id/reject` | `{ note }` | stops the publisher link |
| `GET /api/admin/book-claims?status=pending\|all` | - | "this is my book" claims for the team |
| `POST /api/admin/book-claims/:id/approve` \| `/reject` | `{ note }` | approve = link the book to the author |
| `GET /api/admin/uploads` | - | books uploaded by authors, newest first |
| `DELETE /api/admin/uploads/:bookId` | - | remove an **uploaded** book (never a catalog book); 409 if other data still refers to it |

---

## 7. Data rules that hold for every route

- **Own data only.** `/api/me/*` reads and writes the token's user; ids in the body are book ids, never user ids.
- **No email leaves the server** except the user's own (`GET /api/me`) and, for the team, in admin routes.
- **Emails sent by the server** (`server/mailer.js`): only to the project team (`ADMIN_EMAILS`) and to publishers on `PUBLISHER_EMAILS`; at most 20 a day, no retry on a login failure. Sign-in codes (verify email, forgot password) are sent by Neon Auth, not by this server.
- **Missing optional tables** (search history, book views, reader tags, EASE): the routes keep working and simply skip that part.
- **Deleting an account** deletes its data (`ON DELETE CASCADE`).

*Generated from the route comments in `server/*.js` (November 2026). When a route changes, update the comment at the top of its file and this page.*
