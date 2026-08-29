# TAO-CHAT — the room

One room. Any TAO to speak. Public to read. History kept forever. A salon with a guestbook's permanence, not a Discord.

## Access
1. **Read**: public, no wallet, no sign-in. The room is part of the site.
2. **Write**: signed-in wallet with TAO > 0... any amount; holding one edition copy for one day is a voice. Checked against current TAO at post time.
3. Display: name/.eth per the register, with their TAO quietly beside it in mono ('VISCO.ETH · 1.49M'). The room wears the leaderboard lightly.

## The room
4. Route: /chat on mintface.art (linked from the footer and collector pages). House style... hairlines, mono timestamps, warm white; deliberately spare. No reactions, no threads, no images v1. Words only, 500 chars per message.
5. History: kept forever, scroll-back the whole log (paged loading). The log is part of the register.
6. Live-ness: light polling or SSE... a message appears within a few seconds. This is a salon, not a trading floor; don't build websocket infrastructure for it.

## Moderation
7. Ryan (mintface.eth session): delete any message (hidden from render, kept in data), mute any wallet (they can read, can't write; quietly, no badge). That's the whole toolset v1.
8. Rate limit per wallet (a message every ~15s, burst-capped) so the room can't be flooded even by an enthusiast.

## Plumbing
9. Store: Upstash Redis (Vercel marketplace, free tier fine)... messages as an append-only list + a hidden/mute set. One new env var; CC names it, Ryan adds it.
10. Auth: the same SIWE session as notes and nudges... one sign-in covers all three TAO features.
11. Acceptance: post from a TAO wallet, refusal of a zero-TAO wallet, public read logged-out, delete + mute both working, history paging past 100 messages.

## Noted, not v1
- Per-collection rooms if the one room outgrows itself.
- Agents with TAO can already speak here by design... same rule as nudges: the mechanics don't care what kind of mind holds the wallet. The first agent to buy on the AI rail earns, among other things, a seat in the room.

---

## v1 as built (2026-08-25)

**It shares everything the notes layer already built.** Same Upstash database, same signed-sentence rig, same register read. Nothing new was needed and no new environment variable: `KV_REST_API_URL` and `KV_REST_API_TOKEN` were already there. What the two features do share, the artist's own wallets, now lives in `data/source/artist.json` and is read by both, so a wallet is added or retired once rather than in every feature that cares.

**A session after all, and Ryan was right.** This shipped signing every message, on the reasoning that nothing held between requests is nothing to expire and nothing to steal. That reasoning is sound and the trade was wrong. A wallet tap per sentence is the right price for something you do twice a year and the wrong price for a room: it turns a conversation into a series of approvals, and on a hardware wallet it turns it into a series of walks to the drawer. Nobody talks like that, so nobody talks.

So the signature moved up a level rather than away. One signature says this browser may speak as you until a stated date, and the sentence approved in the wallet says exactly that. It names the date and never a length in words ... thirty days is a number in `data/source/chat.json`, and a sentence reading "for a week" beside a date a month out would be the config and the prose disagreeing in front of the person being asked to trust it. Change the number; the wallet still shows the truth. The token is minted on the server and means nothing anywhere else; the store holds what it stands for. **The address a message is written under comes from the token and never from the request** — a token that says who you are beside a field that also says who you are is a lock with the door left open next to it, and there is a check for exactly that. A stolen token buys a week of talking in one room and nothing else: it does not become a moderator session, and a muted wallet cannot sign in around the mute. Signing out ends it at once, and signing each message by hand still works for anyone who would rather.

**One field for every moderation action.** Deleting and muting both act on `target` — the message number for one, the wallet for the other — sent and signed identically, so there is no mapping between what the browser puts in the body and what it puts in the sentence. The first version had `n` in the body and `target` in the sentence, and the test caught it as a signature that would not verify. That is the failure mode worth designing out: it looks exactly like a wallet problem and it is not.

**A guestbook, so nothing is renumbered.** Every message gets a number, once, in order, and keeps it. The log is a list of those numbers and never changes; deleting rewrites the row rather than removing it. That is what lets the page walk backwards through years of history without the ground moving under a reader while somebody else is speaking — `before=` is a message number, not an offset. The acceptance case seeds a hundred and forty messages and pages back through all of them: no gaps, nothing twice.

**Deleting leaves the gap.** A deleted message reads as `Taken down` in the place it was said, rather than vanishing and closing the hole behind it. A room that quietly reflows over what was removed is a room you cannot trust; a room that says something was here and is not any more is one you can. The artist can still read it, and put it back.

**Muting is quiet, not silent.** A muted wallet reads the whole room and nothing anywhere says it is muted — no badge, nothing on their messages, nothing in what the room hands a reader. They are told plainly on their own screen when they try to speak, because a person staring at a button that does nothing will assume the site is broken and write to say so.

**Two rate limits, doing different jobs.** Fifteen seconds between messages, and ten in ten minutes on top. The floor alone is not enough: fifteen seconds apart for an hour is still a flood, just a patient one. Neither is spent until a message has passed everything else, so being refused for the length of the thing does not also cost somebody their fifteen seconds.

**TAO worn lightly.** `VISCO.ETH · 1.49M TAO`, snapshotted at the moment of speaking rather than read live. The log is permanent and dated, so the figure beside a name means what they held when they said it — which is the only reading that stays true. Exactness is the register's job.

**Live-ness is a poll.** Six seconds, paused while the tab is hidden, asking only for what has been said since the number the page already has. A quiet room costs one small answer. No sockets, as instructed.

**The name.** It is Studio, not The Room, as of 2026-08-25. Worth knowing: `/studio` was already taken by the Artist Virtual Studio, the nudges page, which is publicly reachable and titled "Artist Virtual Studio". So Studio lives at `/chat` and two things on the site now have Studio in the name. The AVS is linked from exactly one place ... the nudges line on a collector page ... so nothing collides in a footer, but it is worth settling deliberately rather than by accident.

**Where it is.** `/chat`, linked from the footer of every page on both sites, and from a line on each collector page. Reading takes no wallet and no sign-in; the composer only appears once a wallet is connected and the room has said it may speak.

**Checks.** `scripts/chat/test-chat.mjs`, thirty-five cases against the real route with real signatures and a stand-in Redis whose clock the test winds forward — which is the only way to check a fifteen second floor without waiting fifteen seconds. It covers the whole of item 11 and then some: speaking with four TAO, refusal at zero, public reading logged out, both rate limits and their windows passing, delete and restore, mute and unmute and what a muted wallet can still see, and paging past a hundred.

**Noted, not built.** Per-collection rooms. And nothing here asks what kind of mind holds a wallet, so the first agent to buy on the AI rail gets its seat without a line of code changing.

---

## Names and tagging (2026-08-26)

Two things arrived together because they interlock: a collector can say what the register should call them, and Studio can name people.

**Names.** `docs/NAMES.md` has the whole of it. What the room cares about is that a name is resolved when a message is drawn rather than frozen when it was said, so a rename reaches every message its author ever left, and every tag anybody ever wrote about them. The room reads `data/collectors-register.json` now rather than `data/collectors.json` — which fixes something that had been quietly wrong since the room opened: `collectors.json` holds only the collectors with pages, so a wallet holding a single edition copy, welcome here by design, was speaking under a short address even where the chain had a name for it.

**The register on the poll.** The register is half a megabyte and the poll runs every few seconds in every open tab, so it is fetched only when there is something to name: a quiet room still costs a length and an empty answer, which is the whole reason the poll exists.

**Tags are wallets.** The browser sends the sentence; the server reads it against the register and stores the wallets and the character ranges they were written over. The name is never stored. A message signed when somebody was `0x6140f00e` reads with their name in it the day after they choose one, and nothing stored changed.

**Names link.** A collector's name on a message goes to their page on the register; MINTFACE goes to the front door, which is the only page he has; a private collector, or anyone below the threshold that gives a page, is drawn unlinked exactly as the register table already draws them. Same tab — it is one register across two deploys, not an external site.

**Being told happens in the room.** A hairline down the left of a message that names you, and a count in the header since your last visit. No email and no push. The count is cleared by the visit that showed it.

**Two things a browser found that no route test could.** The send button was rendered from `ROOM.busy` while the action that redrew the composer was still inside its own `try`, so signing in left it reading 'Sending' until somebody else spoke; and the `finally` relabelled whatever button had been clicked to 'Sign and say', so muting a wallet renamed the mute control. The label is now put back rather than invented, and where the button an action ran from is no longer on the page, the room is drawn again now that it is idle.


---

## The text layer (2026-08-28)

A message could say a URL and not link it, which is the one place the room read as unfinished rather than as spare. So: bare URLs become links, a very small markdown is allowed, and a link gets a card under it saying what it turns out to be.

**Render-time, never stored.** The row keeps the characters somebody typed and nothing else, and `api/_lib/text.js` turns them into a paragraph at the moment of drawing. That is what makes it reach backwards: the messages left before any of this existed, with a raw URL sitting in them as text, came back with working links in them and nothing stored had to change. It is the same argument the names layer already made — a message is a thing that was said, and how it reads is a thing that is true now.

**The splicing moved to the server.** The page used to cut the tags into the text itself. It does not any more, because there is more to splice than tags and a log that is public and kept forever is not a place to keep two escapers and hope they agree. There is one renderer, it is the one the acceptance cases run, and what reaches the page is markup that file wrote character by character around text it escaped first. Nothing a collector types ever arrives as markup.

**The subset, and what is not in it.** `**bold**`, `*italic*`, `[words](url)`, and bare URLs. No headings, no images, no code fences, no raw HTML, ever. Markdown that does not come off renders as the characters that were typed — a half-written link is somebody mid-sentence, not an error — and a `[link](javascript:...)` is text, never a tag. Names outrank all of it: markup may hold a tag (`**@visco.eth**` is a sentence somebody meant) and may never cut one in half.

**Cards, in the register's own voice.** A hairline, the domain in mono, the title in the sans — the block the marks at the foot of a work page are already drawn in. No images from anywhere else on purpose: a preview that hotlinks somebody's three megabyte banner puts it in a log kept forever, pointed at a server that never agreed to serve it. A fetch that fails, or a page with nothing to say about itself, leaves the bare link and says nothing about it.

**The family discount.** `mintface.art` and `collectors.mintface.art` are not scraped. A work URL is answered off the catalogue — thumbnail, title, collection, standing — and a collector URL off the register, as their name and their TAO. Both are read fresh every time rather than cached: a work that sold this morning should say so this afternoon. The register quoting itself should look native, not scraped.

**The fetch is on a short leash.** Previews are asked for by message number, after a page is drawn, and answered from the URLs those rows actually carry — so the room only ever fetches URLs that are already in the log, which took TAO and a signature to put there. On top of that: http and https only, no credentials in the URL, no ports but 80 and 443, no hostname that is not a dotted public name, and every redirect put back through the same check before it is followed. A URL that passes and then 302s to the loopback is the oldest way through a check that only looks once, and there is a case for exactly that. Four fetches a request, a four second timeout, 256KB read, HTML only.

**Fetched once, kept forever.** A card is stored per URL beside the log, so the room never goes back to a site it has already read; a failure is kept for a day, long enough that a page that is down does not cost every reader a timeout and short enough that a page that comes back is seen to.

**Checks.** `scripts/chat/test-text.mjs`, sixty-three cases on the rules alone — the escaping, the trailing full stop that is not part of the address, every private address written six ways, the redirect into one — and `scripts/chat/test-chat.mjs` grew to eighty-five, which now includes a message already in the log reading back with a live link, a `<script>` rendering as text, a work card, a collector card, and a link into a private address getting nothing.


---

## Five refinements (2026-08-29)

Replies, opening at the bottom, the cherry, return-to-send, and reactions. They arrived together because three of them are the same argument: the room had been built as a page that happens to be live, and these are the five places where it needed to be a room.

**This reverses item 4.** The original brief said no reactions and no threads. Reactions are here, and replies are here; threads are still not, and that distinction is the whole of it. A reply is a line pointing at a message. It does not fold the conversation into a tree, it does not collapse anything, and the log still reads top to bottom in the order it was said. The room is still a guestbook.

**A reply is a message number, and nothing else.** Not a name, not an address, not a copy of what was said. That is the same argument the names layer made and it pays out the same way: a reply written to `0x6140f00e` reads with their name in it the day after they choose one, and nothing stored had to change. The parents of a page are read in one MGET alongside it, and most of them are already in hand, because a conversation is mostly answers to things a few lines up.

**And the number is in the sentence.** `Replying to: 42`, above the wallet line. A page that could change the message a signature is hung under could hang your words under somebody else's — the same class of thing as changing the words themselves, and there is a case for exactly that.

**Being answered is being told.** A reply notifies the person it answers, whether or not their name is in the sentence. This is a judgment past the directive, which tied the cherry to mentions: a reply that never reached the person it was written to would be a reply nobody saw, and the cherry is the only notifier this room has. Answering yourself is not being told, the same as naming yourself is not.

**The room opens at the bottom.** A log kept forever that opens at its first line is a room nobody reaches the end of. The newest page, and the view at the foot of it before the first paint — no smooth scroll through a year of history, because gliding there is both slower and stranger than being there. Earlier arrives upward: the affordance at the top stays, because it is what says there is more and it is what a keyboard reaches for, but it is watched as well as pressed, so a reader going backwards does not press a button once per fifty messages. And a message arriving while you read follows you down only if you were already at the bottom.

**The cherry is the notifier, and the count no longer clears itself.** This is the one behavioural reversal in the notes layer: the count used to be cleared by the visit that drew it. An unread mark that clears itself the moment you glance at the page is not an unread mark. So it stands until the cherry is pressed, and pressing it goes to the *earliest* thing you have not read — not the latest, because being told your name was said is being told to go back and read from there. If that message is older than the page on screen, the room walks backwards until it has it.

It is grey and dormant otherwise, and dormant it is not a button at all: there is nowhere for it to take you, and a control that does nothing is worse than a mark that says nothing. Live, it is simply itself — colour arriving is the whole event, which is the energy of the single green dot elsewhere on this site. Nothing bounces.

**Return sends.** Shift and return is a new line, SAY IT stays where it is, and the @ list has first claim on return while it is open. On a touch screen return stays the return key: a software keyboard has no shift to hold, and the only paragraph break a thumb has should not be taken away from it. SAY IT was always the send there.

**Reactions, stored by wallet.** A hash per message, a field per wallet per mark — so one of each per wallet per message is a fact about the key rather than a rule anything has to enforce, and pressing again takes it back. Six marks, in `data/source/chat.json`, and the ceiling is eight: past that it is a keyboard rather than a nod. The room hands the page its own alphabet, so changing the list changes the room. Marks left in a mark that has since been dropped from the list stay on their messages, on the end — they are part of the record, and a room that erased them because a config was edited would be rewriting what people did.

Leaving one takes TAO, like speaking; reading them takes nothing, like everything else here. They ride their own budget over the same ten minutes as the messages — the fifteen second floor would be absurd for something that costs a keystroke, and a wallet writing a thousand hash fields a minute is a hole. And the mark is in the sentence beside the message it goes under, so a cherry cannot be signed and a fire sent.

**Marks are one number on the poll.** A reader with fifty messages on screen cannot be asked what is under each of them every six seconds. The room carries where its marks are up to, as a single counter, and the page goes and asks what they actually are only when that number has moved. A quiet room costs a digit.

**Everything inherits the permanence rule.** Taking a message down takes its marks down with it, for everybody — they are not removed, nothing here is, but a mark stands under something that was said and the room will not leave six cherries under a gap. Nothing new can be put under a gap either, and a gap cannot be answered. Putting the message back puts its marks back, because nothing was ever deleted.

**The ways in are quiet, and they are in the line that was already there.** REPLY and REACT sit in the mono line above the words and arrive under the pointer. A row of their own would have to be there whether or not anybody was looking at it, or every message would grow a line taller on hover; that line is there anyway. On a touch screen there is no pointer to arrive under, so they sit there faintly. They are offered exactly when the composer is a box you can type in — a wallet the room will let speak, signed in for the month. Signing per action still works and the route still takes it, but a tap on a cherry that opens a hardware wallet is not what a tap on a cherry should do.

**Checks.** `scripts/chat/test-chat.mjs` is a hundred and thirty-six now: a reply carrying a number and reading back with today's name, a reply to nothing and a reply to a gap both refused, a reply changed after signing refused, being answered counting as being told and answering yourself not, the cherry pointing at the earliest unseen and going quiet once read, one mark per wallet per message however many times it is pressed, two wallets counting two, a mark Studio does not offer refused, no TAO and muted both refused, a cherry signed and a heart sent refused, a message taken down losing its marks and getting them back, and the poll's one number moving when somebody reacts.


---

## The cherry leaves the room (2026-08-29)

The nav landed, and the cherry went into it. `docs/NAV.md` has the whole of it; what the room lost and gained is here.

**One cherry, and it is not in here any more.** It was in the room's own masthead, which meant being named only reached you if you were already in the room — the one place you would have found out anyway. It is in the nav now, on every page of both deploys, so a mention finds you halfway down a collection page. Pressing it from anywhere else deep-links to `/chat#m-<n>`; the room reads that hash, opens at that message rather than at the latest, walks back through the log to reach it, and marks the count read on arrival. Pressing it *in* the room scrolls instead of reloading the page you are already on — `MF.nav.onCherry`, set by chat.html.

**The session moved up a level again.** `MF.session` in `mintface.js` holds the token, the sentence and the sign-in, because the nav signs in with the same signature on every page and there cannot be two of it. The room keeps only its own question — is the session the wallet in hand — and the browser's half of the signed sentence now exists once rather than in every page that signs something.

**A session says who you are.** The room used to wait for a connect that a signed-in reader has no reason to perform: it read `ROOM.wallet` from the wallet and nothing else, so somebody with thirty days left on a signature still saw "Connect a wallet to speak". The token is what speaks here and the wallet is only needed to sign, which a session is the standing permission not to do. It also stopped the nav and the composer disagreeing about who was reading.

**Your name, once.** It was under the masthead, in the composer, and now in the nav. Two of those were the same fact. The masthead line has gone; the composer keeps its own because it says what you hold beside it, which is a different sentence.

---

## Pictures (2026-08-30)

A signed-in TAO holder can put one image on a message. Words are still required: a picture is something a message carries, not a message, and a log of bare photographs is a different room.

**The resize is the strip.** The file never travels as a file. It is decoded, drawn onto a canvas at two thousand on the long edge, and re-encoded off that canvas — and a canvas has no idea what EXIF is. So the GPS coordinates a phone writes into every photograph never leave the phone, not because anything went looking for them but because nothing carried them across. WebP where the browser has it, JPEG where it does not, quality stepping down rather than size, capped at 1200KB.

**Orientation survives by being applied rather than copied.** `createImageBitmap(file, { imageOrientation: 'from-image' })` bakes the rotation into the bitmap, so a photograph taken sideways arrives the way up it was taken and nothing downstream has to know why.

**The server checks rather than trusts.** It sniffs the container against the claimed type, so a file that says WebP and is not gets refused; and it walks the JPEG segments and the WebP chunks for EXIF or XMP and refuses anything still carrying them. That turns "the page strips it" into "the room will not take it otherwise" — which is the version that holds when the bytes did not come through the page.

**A picture is signed with the words it came with.** The sentence carries a sixteen-character fingerprint of the bytes rather than the bytes, because a wallet prompt is not going to show anybody a megabyte of base64 and they would not read it if it did. What it buys is that the picture attached to a signature is the picture that lands in the log.

**One key, one bucket, one line to move it.** `chat/<year>/<random>.<ext>` in R2, and the row keeps the key rather than an address — the bucket can move; the log cannot. Nothing new to configure: the same R2 credentials the catalogue already uses.

**It inherits the permanence rule.** Deleting a message takes its picture down for everybody, the artist still sees it as he still sees the words, and putting the message back puts the picture back, because nothing was ever removed. Inline at a modest height with the hairline every image on this site gets; a click opens it in the lightbox, on the same paper.

**One thing the harness found that no review would have.** A browser can answer the WebP feature test on a single pixel and then never call back on a real image — headless Chrome does exactly that. A composer sitting on "Reading the picture" forever because an encoder never returned is worse than a slightly larger JPEG, so the encode is time-limited and the first one that does not come back settles the format for the rest of that picture. It was found by watching a real browser stall, and the fallback is watched working on that same stall.

**Checks.** `scripts/chat/test-chat.mjs` is 211: a picture into a stand-in bucket and the key on the row, a file lying about its type, a file that is not an image, a photograph still carrying its camera data, one over the cap — and none of them reaching the bucket. Plus the signature covering the bytes, and the delete/restore round trip.

## The reply bug, and the coercion behind it (2026-08-30)

A collector reported two things: every message they sent after replying once appeared to reply to the same person, and clicking a name in that line jumped to that person's first message. One bug.

A message that answers nothing is stored with `reply: null`. The render read `Number(row.reply)`, and `Number(null)` is `0`, which is a perfectly good message number — the first thing anybody ever said in this room. So every plain message written since replies shipped drew an answer line pointing at message zero, naming whoever said it, and the name in that line went to message zero. Nothing was sticky and no state was wrong: the chip was right, sending cleared it, the row held a null. The render was lying about the row. Messages from before replies existed have no `reply` key at all, `Number(undefined)` is `NaN`, and they were always fine — which is why it read as new.

The guard is on the stored value now, before it is ever a number. And the reply line stopped overloading a name: the arrow goes to the message, the name goes to the person, the way every other name on this site does. Escape puts the chip down as well as the cross.
