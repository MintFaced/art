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
