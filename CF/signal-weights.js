/**
 * How much each thing a BookBridge user DOES counts for the ALS model - in
 * "stars" (ALS confidence c = 1 + alpha * value / 5, so 5 counts most).
 * ONE place for these numbers, used by:
 *   CF/retrain.js            - daily training (the book vectors learn from them)
 *   server/me-routes.js      - the user's own vector, live, on every visit
 *
 *   rating                        its stars (1-5)
 *   "I finished it", no rating    4
 *   on the TBR list now           1      goodbooks "want to read" measured best at 1 (CF/experiment-to-read.js)
 *   search -> opened a result     3.5    a clear choice: they looked for it and picked it
 *                                        +0.5 for every extra time they searched the same thing (max 5)
 *   search, nothing opened        0.5    for each of the top 3 results: some interest, but we can't
 *                                        tell in what - so a little only; +0.25 per extra search (max 1.5)
 *   asked the chatbot about it    3      pressed "Ask about this book" (a card, the book's page or in the
 *                                        chat): interest, but not a choice yet - between the TBR and an
 *                                        opened search result; +0.5 for every extra time (max 4).
 *                                        Only this explicit press counts - the books the chatbot itself
 *                                        suggested say nothing about the reader (chat_turns.about_book_id)
 *   "Not for me"                  never positive - the book is left out
 *   (searches with no results are not saved at all - they say nothing)
 *
 * The strongest signal for a book wins (a 5-star rating is not lowered by a click).
 * The search and chat weights are a design choice, not measured: goodbooks has neither.
 * They can be measured once BookBridge has real users (model_runs / probe check).
 */

const SIGNALS = {
  finished: 4,
  tbr: 1,
  searchClick: 3.5, searchClickRepeat: 0.5, searchClickMax: 5,
  searchSeen: 0.5, searchSeenRepeat: 0.25, searchSeenMax: 1.5, searchSeenTop: 3,
  chatAsk: 3, chatAskRepeat: 0.5, chatAskMax: 4,
};

/** [{ bookId, value }] from one user_searches row */
function searchSignals(row) {
  const times = Math.max(1, Number(row.search_count) || 1);
  const out = [];
  if (row.clicked_book_id) {
    out.push({ bookId: Number(row.clicked_book_id), value: Math.min(SIGNALS.searchClickMax, SIGNALS.searchClick + SIGNALS.searchClickRepeat * (times - 1)) });
  } else {
    const seen = Math.min(SIGNALS.searchSeenMax, SIGNALS.searchSeen + SIGNALS.searchSeenRepeat * (times - 1));
    for (const b of (row.result_book_ids || []).slice(0, SIGNALS.searchSeenTop)) out.push({ bookId: Number(b), value: seen });
  }
  return out;
}

/** the value of "asked the chatbot about this book" `times` times */
const chatAskSignal = (times) => Math.min(SIGNALS.chatAskMax, SIGNALS.chatAsk + SIGNALS.chatAskRepeat * (Math.max(1, Number(times) || 1) - 1));

module.exports = { SIGNALS, searchSignals, chatAskSignal };
