// "Did you know?" for the bookworm (components/Bookworm.js): short facts about books that are in
// the BookBridge catalog, each with the source it was checked against (English Wikipedia,
// November 2026).
// A fact is only shown when its book is found in the catalog (then it links to the book's page).
//   title  - the catalog title, matched exactly (lower case); prefix: true = the title starts with it
const W = (page) => `https://en.wikipedia.org/wiki/${page}`;

export const FACTS = [
  { title: "harry potter and the sorcerer's stone", text: "Harry Potter and the Sorcerer's Stone first came out in Britain in 1997 as Harry Potter and the Philosopher's Stone – the American edition changed “Philosopher's” to “Sorcerer's”.", source: W("Harry_Potter_and_the_Philosopher%27s_Stone") },
  { title: "the hobbit", text: "The Hobbit was published in 1937 – seventeen years before the first volume of The Lord of the Rings.", source: W("The_Hobbit") },
  { title: "the fellowship of the ring", text: "The Lord of the Rings is often called a trilogy, but Tolkien meant it as a single work – it was published in three volumes in 1954–55.", source: W("The_Lord_of_the_Rings") },
  { title: "pride and prejudice", text: "Jane Austen's first title for Pride and Prejudice was First Impressions.", source: W("Pride_and_Prejudice") },
  { title: "frankenstein", text: "Mary Shelley began Frankenstein in 1816 near Lake Geneva, after Lord Byron suggested that each of his guests write a ghost story.", source: W("Frankenstein") },
  { title: "1984", text: "Nineteen Eighty-Four (1949) gave everyday English words like “Big Brother” and “doublethink”.", source: W("Nineteen_Eighty-Four") },
  { title: "the great gatsby", text: "When it came out in 1925, The Great Gatsby was a commercial disappointment – it sold fewer than 20,000 copies in its first months.", source: W("The_Great_Gatsby") },
  { title: "to kill a mockingbird", text: "To Kill a Mockingbird won the Pulitzer Prize for Fiction in 1961.", source: W("To_Kill_a_Mockingbird") },
  { title: "dracula", text: "Dracula (1897) is told entirely through letters, diary entries and newspaper clippings.", source: W("Dracula") },
  { title: "alice's adventures in wonderland", prefix: true, text: "“Lewis Carroll” was the pen name of Charles Lutwidge Dodgson; Alice's Adventures in Wonderland came out in 1865.", source: W("Alice%27s_Adventures_in_Wonderland") },
  { title: "moby-dick or, the whale", text: "The full title of Moby-Dick is Moby-Dick; or, The Whale – Herman Melville published it in 1851.", source: W("Moby-Dick") },
  { title: "little women", text: "Little Women was first published in two volumes, in 1868 and 1869.", source: W("Little_Women") },
  { title: "the diary of a young girl", text: "Anne Frank received the diary as a present for her thirteenth birthday, in June 1942.", source: W("The_Diary_of_a_Young_Girl") },
  { title: "brave new world", text: "The title Brave New World comes from Miranda's line in Shakespeare's The Tempest.", source: W("Brave_New_World") },
  { title: "of mice and men", text: "The title Of Mice and Men comes from Robert Burns' poem “To a Mouse”.", source: W("Of_Mice_and_Men") },
  { title: "the book thief", text: "The Book Thief is narrated by Death.", source: W("The_Book_Thief") },
  { title: "dune", text: "Dune won both the Hugo and the Nebula Award for Best Novel.", source: W("Dune_(novel)") },
  { title: "the little prince", text: "Antoine de Saint-Exupéry both wrote and illustrated The Little Prince.", source: W("The_Little_Prince") },
  { title: "gone with the wind", text: "Gone with the Wind won the Pulitzer Prize for Fiction in 1937.", source: W("Gone_with_the_Wind_(novel)") },
  { title: "the handmaid's tale", text: "The Handmaid's Tale won the first Arthur C. Clarke Award, in 1987.", source: W("The_Handmaid%27s_Tale") },
  { title: "the catcher in the rye", text: "Holden Caulfield first appeared in a short story, “Slight Rebellion off Madison”, which Salinger sold to The New Yorker in 1941 – ten years before the novel.", source: W("The_Catcher_in_the_Rye") },
  { title: "the hunger games", text: "Suzanne Collins has said the idea for The Hunger Games came to her while flipping between a reality show and footage of the invasion of Iraq.", source: W("The_Hunger_Games_(novel)") },
  { title: "twilight", text: "Stephenie Meyer has said Twilight began with a dream she had in 2003.", source: W("Twilight_(Meyer_novel)") },
];

const norm = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
export const factFor = (book) => FACTS.find((f) => (f.prefix ? norm(book?.title).startsWith(f.title) : norm(book?.title) === f.title));
export const matches = (fact, title) => (fact.prefix ? norm(title).startsWith(fact.title) : norm(title) === fact.title);
