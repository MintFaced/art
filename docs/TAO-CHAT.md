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

So the signature moved up a level rather than away. One signature says this browser may speak as you until a stated date, and the sentence approved in the wallet says exactly that, in those words. The token is minted on the server and means nothing anywhere else; the store holds what it stands for. **The address a message is written under comes from the token and never from the request** — a token that says who you are beside a field that also says who you are is a lock with the door left open next to it, and there is a check for exactly that. A stolen token buys a week of talking in one room and nothing else: it does not become a moderator session, and a muted wallet cannot sign in around the mute. Signing out ends it at once, and signing each message by hand still works for anyone who would rather.

**One field for every moderation action.** Deleting and muting both act on `target` — the message number for one, the wallet for the other — sent and signed identically, so there is no mapping between what the browser puts in the body and what it puts in the sentence. The first version had `n` in the body and `target` in the sentence, and the test caught it as a signature that would not verify. That is the failure mode worth designing out: it looks exactly like a wallet problem and it is not.

**A guestbook, so nothing is renumbered.** Every message gets a number, once, in order, and keeps it. The log is a list of those numbers and never changes; deleting rewrites the row rather than removing it. That is what lets the page walk backwards through years of history without the ground moving under a reader while somebody else is speaking — `before=` is a message number, not an offset. The acceptance case seeds a hundred and forty messages and pages back through all of them: no gaps, nothing twice.

**Deleting leaves the gap.** A deleted message reads as `Taken down` in the place it was said, rather than vanishing and closing the hole behind it. A room that quietly reflows over what was removed is a room you cannot trust; a room that says something was here and is not any more is one you can. The artist can still read it, and put it back.

**Muting is quiet, not silent.** A muted wallet reads the whole room and nothing anywhere says it is muted — no badge, nothing on their messages, nothing in what the room hands a reader. They are told plainly on their own screen when they try to speak, because a person staring at a button that does nothing will assume the site is broken and write to say so.

**Two rate limits, doing different jobs.** Fifteen seconds between messages, and ten in ten minutes on top. The floor alone is not enough: fifteen seconds apart for an hour is still a flood, just a patient one. Neither is spent until a message has passed everything else, so being refused for the length of the thing does not also cost somebody their fifteen seconds.

**TAO worn lightly.** `VISCO.ETH · 1.49M TAO`, snapshotted at the moment of speaking rather than read live. The log is permanent and dated, so the figure beside a name means what they held when they said it — which is the only reading that stays true. Exactness is the register's job.

**Live-ness is a poll.** Six seconds, paused while the tab is hidden, asking only for what has been said since the number the page already has. A quiet room costs one small answer. No sockets, as instructed.

**Where it is.** `/chat`, linked from the footer of every page on both sites, and from a line on each collector page. Reading takes no wallet and no sign-in; the composer only appears once a wallet is connected and the room has said it may speak.

**Checks.** `scripts/chat/test-chat.mjs`, thirty-five cases against the real route with real signatures and a stand-in Redis whose clock the test winds forward — which is the only way to check a fifteen second floor without waiting fifteen seconds. It covers the whole of item 11 and then some: speaking with four TAO, refusal at zero, public reading logged out, both rate limits and their windows passing, delete and restore, mute and unmute and what a muted wallet can still see, and paging past a hundred.

**Noted, not built.** Per-collection rooms. And nothing here asks what kind of mind holds a wallet, so the first agent to buy on the AI rail gets its seat without a line of code changing.
