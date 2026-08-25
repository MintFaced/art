# ARTWORK-NOTES — a network of notes across the works

Work pages grow a notes layer: the artist, the work's collector, and senior collectors writing about the art... for each other to read. The artworks become the rooms.

## Who can write
1. **The artist**: mintface.eth signature. Any work, any time. Rendered distinctly... ARTIST'S NOTE label.
2. **The current collector**: signature from the wallet holding the work (chain-verified at post time). Their work only. **Public/private toggle** per note... private renders only to them when signed in.
3. **Senior collectors... 69,000+ TAO**: any MintFace work, always public. Threshold checked against **current TAO at post time** (sold-below-threshold closes the privilege for new notes; existing notes stand). Label: COLLECTOR'S NOTE with name + their TAO at posting.

## The notes themselves
4. 500 characters max, plain text (line breaks kept, no links rendered as links in v1... paste-safe).
5. Author can edit or delete their own. Edits show a quiet (edited).
6. **Artist moderation**: Ryan can hide any note, quietly... hidden means gone from render, kept in data. No public moderation theatre.
7. **On sale of the work**: the former collector's public notes STAY, moving into the provenance fold as PROVENANCE NOTES... attributed and dated with their tenure ('dsanches-vault.eth, collector 2022–2024'). Private notes die with the tenancy (no longer renderable to anyone). Notes are provenance too.

## Where they render
8. Work page, below Details/Traits: NOTES section... artist note first if present, then current collector's, then senior collectors', newest first. Folded to a count when more than three ('NOTES · 7').
9. Collector pages: a NOTES line... how many they've written, linking to the works.
10. A quiet /notes index (optional v1.1): recent notes across all works... the network legible in one stream. Build only if cheap.

## Plumbing
11. Auth: SIWE wallet signature per session (same rig as nudges). Store: the same KV/store chat will use... notes are rows: work, wallet, text, public flag, timestamps, hidden flag, tenure snapshot.
12. Rate limit per wallet per day (say 20) so the network stays considered.
13. Acceptance: artist note on any work; collector note public + private on their own; a 69k+ collector noting someone else's work; sub-threshold wallet correctly refused; a simulated sale moving public notes to provenance and killing private ones; Ryan hiding one.

---

## v1 as built (2026-08-25)

**One thing is needed before it appears.** The notes want a store, and the site has never had one: the catalogue is public files in the repo, and a private note in a public file is not private. So this runs on Upstash Redis, the store TAO-CHAT.md already chose. Add it from the Vercel marketplace (free tier is ample) and it will set `KV_REST_API_URL` and `KV_REST_API_TOKEN`; a database made by hand sets `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, and either pair is read. **Until one of those pairs exists, nothing changes anywhere on the site** — `/api/notes` answers with an empty layer, the work page draws no section, and the collector line does not appear. That is deliberate: a half-configured feature should be invisible, not broken.

**No session.** The directive says notes and nudges should share one, and they now share something better: none. A wallet signs a sentence saying exactly what it is writing and where, and that signature *is* the authorisation for that one act. Nothing is held between requests, so there is nothing to expire and nothing to steal, and the sentence a person approves in their wallet is the thing that happens. It is the rig the nudges already use. `scripts/notes/test-route.mjs` signs with a real key and checks that changing a word after signing is refused, and that a signature twenty minutes old is refused too.

**Chain-verified means the chain.** "The current collector" is settled by an `ownerOf` or `balanceOf` call at post time, not by last night's sweep, so a collector who bought an hour ago can write an hour ago. The catalogue is the fallback for a work on Bitcoin, which has no Ethereum call to make, and for an RPC having a bad minute — telling somebody they do not own their own painting because a node was slow is the wrong failure. The same question is asked on the way in, so the page only offers a form to a wallet that will be allowed to use it.

**The sale is not a job.** Item 7 asks for public notes to move into provenance when a work sells and private ones to die with the tenancy. Nothing moves them: a note's standing is worked out from its author's standing with the work every time the page is drawn. Held it when they wrote it and hold it still, and it reads as a collector's note. Held it then and not now, and it reads as a provenance note, dated with the tenure — `collector 2022–2024`, from the acquisition date snapshotted when they wrote it and the date whoever holds it now came by it. A private note renders while its author holds the work and to nobody afterwards, its author and the artist included. It is still in the data; it is simply no longer renderable, the way a conversation in a room stops when you no longer live there. Nothing to run, nothing to get out of step, and a work that changes hands twice reads correctly both times without anyone touching a row.

**Where they render (revised 2026-08-25).** The first build gave notes a section of their own below Details and Traits. They are now the **last row of the Details table** instead, which says what they are more plainly than a heading could: one more thing that is true about this work, beside its year and its medium. The row shows the newest note with its author and date beneath in the small mono; where there are more, `ALL NOTES · 4` unfolds the rest inline, newest first, in the same table language.

Writing happens in the row. `ADD A NOTE` — or `EDIT`, where this wallet has already written — sits beside the row label, and clicking it turns the value into the input. The public/private toggle lives in that inline editor, and only for a note on your own work. No page to go to, no dialogue to open: the table is the editor.

**And the row is silent when it has nothing to say.** No public note and no right to write one, and it never enters the document at all — no empty state, no explanation of a thing you cannot do. That rule has two halves pulling against each other and the first build got the second one wrong: a work with no notes rendered nothing even for the wallet entitled to write the first one, so there was nowhere to start. Identity is now settled without asking anybody anything — `eth_accounts` prompts nothing and a wallet already connected to the site answers — so the pen is offered to exactly the people who can use it. `scripts/notes/test-row.mjs` pins both halves.

Provenance notes moved into the existing Provenance fold, where a former collector's tenure already lives. The row shows the living notes; the fold holds the record.

A collector page carries the line, counting only what a stranger may read so the number never hints at a private note. `/notes` is the log: every public note site-wide, newest first, each with the work's thumbnail, the words, the author and their role — ARTIST, COLLECTOR, or a collector writing from outside the work with the TAO figure that lets them — and a link to the work. The footer's NOTES link points there.

**What refuses, and how it says so.** Below the line, a wallet is told the line and what it holds. Over five hundred characters, it is told the count. Twenty notes in a day is the last one. Only the wallet holding a work may keep a note private — not a senior collector, not the artist. Only the artist may hide, and hiding removes a note from the page and the stream while leaving it in the data — visible to Ryan alone, faded and marked, with a Show beside it, because moderation you cannot undo is a trap rather than a tool. A hidden private note stays private even from him: privacy is checked before moderation. Only the author may edit or delete, and an edit shows as `(edited)`.

**Checks.** `scripts/notes/test-notes.mjs` runs the acceptance list in item 13 against the real rules and store code with a stand-in Redis: forty-four cases, including a work sold out from under a collector and what each of the four possible viewers can see afterwards. `scripts/notes/test-route.mjs` runs the route itself, twenty-three cases, with real signatures over the real message. The one thing neither can check is Upstash answering, which is the first thing the env var will prove.

**Files.** `api/_lib/notes.js` is the rules and the store, with no HTTP, no chain and no MintFace in it. `api/_lib/kv.js` is forty lines of Upstash over `fetch`. `api/notes.js` is the route. `data/source/notes.json` holds the artist wallets, the 69,000 line, the limits and the fold. `notes.html` is the stream.
