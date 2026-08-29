# NAMES — what a collector is called

A wallet is an identity and a poor one to read. The register has always been able to name somebody: a reverse ENS record, or a name Ryan wrote down beside an address. This is the third source, and the only one the collector controls.

## Precedence

One order, everywhere, and it never varies:

```
what Ryan wrote down  >  what they chose  >  their ENS  >  the address
```

`api/_lib/names.js` is the one place that decides it. Ryan's overlay outranks a self-set name for the same reason he can take a note down — the register is his, and a name that has to be argued about is a name he can simply set. A collector under an overlay may still set a name and is told, on the page, that it waits underneath. A reset clears what somebody chose and leaves them their ENS, which is theirs on chain and was never his to take.

## The slug never follows the name

URLs stay ENS-and-address canonical. `collectors.mintface.art/visco.eth` is built from a reverse record or from an address prefix, and it is built that way whatever anybody is called. A name is a label; an address is an address. A link made this morning still finds somebody who has second thoughts this afternoon, and nothing on either site ever 404s because a person changed their mind.

## What may be used

Thirty-two characters, plain text, one line. No `@` — that is how Studio starts a tag, and a name carrying one would make the tag grammar ambiguous. No `.eth` unless the wallet already resolves to it, because an .eth name is claimed on chain rather than typed here.

**Uniqueness folds hard.** Two names collide when they *look* alike, not when they *are* alike: case, spacing, punctuation, accents, Cyrillic and Greek homoglyphs, and `0`/`o`, `1`/`l`/`i`, `5`/`s` and the rest all fold home before the comparison. `MintFace`, `M1ntFace`, `mint-face` and `Mіntface` with a Cyrillic і are one name. That costs a collector the occasional name that was free in the strict sense; it buys the register the guarantee that two collectors never read as one, which is the trade the right way round.

Three ways a name is not free: another collector chose it, another collector's ENS already reads as it, or Ryan wrote it down beside another address. `MINTFACE` and its close variants are kept, along with the artist's other wallets and the words a page uses to speak with its own authority.

The claim itself is `HSETNX`. Two wallets signing the same name in the same second both reach the store and exactly one gets the key back.

## Where a name lives, and how a page gets it fresh

The register is a nightly file; a name is not a nightly thing. So self-set names live in the store beside the notes and the room, and `GET /api/names` publishes the whole overlay — a few kilobytes, cached at the edge for thirty seconds. Pages lay it over the record they were served, exactly the way a collector page already lays the live TAO board over its own figures. A page that cannot reach it shows the register's name: a little behind, and never wrong in kind.

Server-side, `api/_lib/register.js` does the same join once per request and hands back one lookup. Four routes use it — the room, the notes, the nudges and the OG cards — and it reads `data/collectors-register.json` rather than `data/collectors.json`, because the index holds only the eight hundred collectors with pages. A wallet holding one edition copy is welcome in Studio by design and used to speak under a short address even where the chain had a name for it.

## Names are resolved when drawn, never frozen

Every message, note and ledger row stores what its author was called on the day, and then ignores it. The register is asked again at render time and the stored name is only the fallback for a wallet the register has since lost sight of. So a collector who renames on Tuesday is renamed on everything they have ever written, and nothing stored had to change for it.

## Asked before anybody is sent to their wallet

`GET /api/names?check=<name>&address=<wallet>` answers `{ free, why }` and writes nothing. The page asks it while the name is being typed and keeps the button shut until it has an answer, so nobody signs for a name the register was never going to allow — on a hardware wallet that is the difference between being told now and being told after a walk to the drawer. A question in flight outranks the last answer, so a refusal never sits under a name that is no longer the one being typed.

It is a courtesy, not the guard. The server checks the same thing again when the signature arrives, because a name can be taken in the seconds between reading "that name is free" and a wallet answering.

## Signing

One signature per change, the same rig as the notes and the nudges. There is no session: a name is set twice a year, and a signature per change is the right price for something everybody else has to read. The sentence is built by `nameMessage()` on both sides, to the character.

```
MintFace ... the register

Action: set
Name: Ryan OG
Wallet: 0x…
Issued: 2026-08-26T…

Signing writes this name on the register. It moves nothing and spends nothing.
Your wallet stays your address, and your page keeps its URL.
```

Every change is logged — `name:log` — because a name is what everybody else sees, so a name that changed is a thing that happened. `GET /api/names?log=&viewer=` reads it, and only for Ryan: the log is his the way the power is.

## Tagging

Typing `@` in Studio opens the register, not a contact list — everybody who holds a MintFace work is in it, whether or not they have ever been in the room. Muted wallets are left out: muting is quiet, and a name the room offers to put in somebody's mouth is not.

**A tag is a wallet.** The browser sends the sentence and nothing else; the server reads the text against the register and the wallets that fall out of that reading are the tags. If the browser sent them, a page could quietly tag somebody the words never named — which is how a tag stops being a thing you said and becomes a thing done to you. What is stored is the wallet and the range of characters it was written over, never the name, because the name is the part that changes.

Matching is longest-first, so a name with a space in it is one name; a tag begins at a word boundary, so an email address is not four tags and a surname; and a tag never ends on punctuation, so `@visco.eth,` tags `visco.eth` and leaves the comma in the sentence.

Rendering splices the current name into the ranges. The sentence that was signed is still the sentence that was signed.

## Being told

Inside the room, and nowhere else. No email, no push. A tagged wallet's mentions carry a hairline down the left of the message — the treatment, not a colour, because the single green on this site is for availability — and the room header shows a count since the last visit beside the reader's own name. A first visit counts everything, since none of it has been read, and simply does not claim there was a "since". The visit that draws the count is the visit that clears it.

Tags ride the same window as the messages carrying them. A message limit alone does not limit tagging: ten messages naming eight people each is eighty notifications inside the allowance, which is the whole of the spam. `max_tags` caps one message and `tag_burst` caps the ten minutes, and the names run out before the messages do.

## Acceptance

`node scripts/names/test-names.mjs` — the real routes, real signatures, a stand-in store. It sets a name and watches it reach the room; renames a collector and checks that the message they left yesterday and the tag somebody else wrote about them both say the new name today, while the signed text is untouched; and walks the collision, impersonation, overlay, reset, log, mute and rate-limit cases.

The pages themselves were walked through in a real browser: two local origins so the cross-origin POST and its preflight are exercised, the real HTML and the real handlers, and an EIP-6963 provider announced into the page with `personal_sign` forwarded to a key the harness holds. That is what caught the wallet prompt for a doomed name, the stale refusal, the autocomplete list anchored to the wrong element and the space before a question mark. None of them were visible to a route test, and all of them were obvious on screen.

---

## The fourth tier: one name pointing back (2026-08-29)

```
what Ryan wrote down  >  what they chose  >  their reverse record  >  the one name that resolves to them  >  the address
```

**The hole this fills.** A reverse record is something a wallet has to set, and plenty of people register a name, point it at their wallet, and never set the primary. The register's own case is `josephj.eth` — the second largest holding on the board, 982,859 TAO, reading as `0xe09c0d24` while josephj.eth has resolved to that wallet the whole time. The third tier asks *what is this address called*, which is the reverse record and had already been asked. This asks the other question — *what names resolve to this address* — which is a forward index, and only the subgraph can answer it.

**One name or none.** If exactly one name resolves to a wallet, that is what the register calls it. Two, or twenty, and it says the address. Ambiguity is never guessed at, and the many-names case is exactly where an impersonation would live: pointing a name at somebody else's wallet costs nothing and proves nothing, and the only thing that makes a single pointer worth anything is that it is the only one. mintface.eth's own wallet has five names pointing at it, which is the rule demonstrating itself.

**What it will not do.** A reverse record appearing anywhere outranks it. So does a name somebody signed for, and so does Ryan, whose reset power covers these like any other name — the tier is only ever consulted for a wallet nothing else names. And it never touches a slug: `nameSlug` reads the reverse record and the written-down name and is deliberately blind to this one, so a page URL is still minted from something somebody stands behind. The address slug stays alive either way, so nothing rots when a wallet moves between tiers.

**Re-verified nightly, remembered never.** The ownership sweep asks the subgraph again on every run and keeps nothing from the night before. A name re-pointed somewhere else simply does not come back, and the wallet is an address again on that run. If the subgraph will not answer, the pass is skipped and yesterday's file stands rather than a hundred and fifty names disappearing into somebody else's outage — and the run flags it.

**The audit trail knows which tier named whom.** `fwd` is its own column in `data/collectors-register.json`, appended rather than inserted so nothing that reads a column by name can be moved out from under; `source` reads `ens-forward` rather than `ens`; and `data/ens-forward.json` keeps the wallets that fell through as ambiguous, with the names that made them ambiguous. Nothing on the register looks different to a reader. The difference is a fact about the name, and this file is for facts about names.

**Expired names and unreadable ones are not names.** A name past its expiry has stopped resolving, and a label the subgraph has never seen the preimage of — `[9f8c2a…].eth` — is nobody's name. Both are dropped before the one-name rule sees them, which matters: a wallet with one live name and one expired one is named, not ambiguous.

**Where the data comes from, and the one thing to watch.** `api/_lib/ens.js`, against the ENS subgraph, in batches of two hundred with paging, because a truncated answer would read as "this wallet has one name" for a wallet that has six. The endpoint is `ENS_SUBGRAPH_URL` with the hosted service as the default. That hosted service has been deprecated for a while and answers anyway; when it stops, the replacement is a Graph gateway URL with a key in it, which is one environment variable rather than a deploy.

**The backfill, run 2026-08-29.** 3,681 wallets. 1,217 already named by a stronger tier and not asked about. Of the 2,464 asked: **156 named by forward resolution**, **77 fell through as ambiguous**, 2,231 still a bare address. josephj.eth is the first of the 156 by TAO. The ambiguous list is the rule earning its keep — one wallet has twenty-two names pointing at it, another ten, another nine.

**Teaching the gap.** A collector signed in on their own page, named by the fourth tier or by nothing, is told what is true: `josephj.eth resolves to this wallet, which is how the register knows to call it that. Nothing on chain says so from this end. Set a primary name in ENS and every site reads it, or choose one here.` Both unclaimed tiers get the same line, because a pointer names you and is still not you saying so, and a signature here remains stronger proof than any pointer. **This line did not previously exist** — the directive carried it forward from an earlier one, and there was nothing in the code to carry. It is new as of this change.

**Acceptance.** `node scripts/names/test-ens.mjs` — forty-one cases with a stubbed subgraph that answers the query it is actually sent, so the batching, the paging, the retries and the one-name rule are exercised against the shape of a real answer. Expiry, unreadable labels, duplicate names, a wallet nothing points at, precedence against all three tiers above it, the register file round trip, a register from before the column existed, and the slug refusing to adopt it.
