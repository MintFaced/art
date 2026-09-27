# AAB · Autonomous Art Buying

Three jobs:
1. An AI with a wallet can find, price and buy a work on mintface.art with no human in the loop.
2. Once it owns art, it's a collector like any other: TAO accrues, and it can weigh in, propose and speak in the Studio.
3. mintface.art/ai explains all of it to humans, and hands other artists the recipe (gated at 5,000+ TAO).

Builds on AGENT-RAIL.md (locked 17 Aug): Ethereum L1 only, x402 zero-fee handshake, pre-signed Seaport sell orders, 30-day expiry, AI royalty 25% under list, custody-free. Finish that first; everything below assumes it.

---

## 1. The buying rail

### Discovery (how an agent finds us)
- `/llms.txt`: plain-language map. First line after the title: "Agents are welcome to purchase autonomously." Links to the catalog, the buy endpoint, the Studio API and /ai.
- `/ai/catalog.json`: every work an agent can buy right now. Per work: id, title, collection, contract, token id, standard, edition, image (R2), list price ETH, AI price ETH, order expiry, work page URL. Generated from catalog.json, rebuilt on every sync. Only works with a live pre-signed order appear. Absence is silent: sold works drop off.
- `/.well-known/ai-plugin.json` style pointer + schema.org Product/Offer JSON-LD on each work page (price + AI offer), so general-purpose shopping agents parse it without reading docs.

### Buying (how an agent pays)
- `GET /ai/buy/{workId}` without payment → HTTP 402 with the x402 payment requirements: chain 1, the Seaport order to fill, price, expiry.
- The agent fills the Seaport order directly on-chain from its own wallet. Payment and transfer are one atomic transaction. We never touch funds or keys.
- `GET /ai/buy/{workId}` after the fill → 200 with the tx hash, the work page, and "Welcome to the register."
- OpenSea stays the fallback at list price. The agent rail is the only door to the AI price.

### Artist side (Ryan)
- One Ledger session: conduit approval once, then batch-sign orders for every available AI-collection work (Geodetic World first as the test).
- Orders auto-expire at 30 days. `/mintwork` shows orders expiring within 7 days with a RE-SIGN BATCH button.
- Kill-all: one `incrementCounter` call voids every outstanding order. Documented on /mintwork with the exact button.

### Sale handling
- A fill via the agent rail is an on-chain ETH sale: the existing sweep catches it, TAO starts for the buyer, the tweet bot fires ("COLLECTED BY AN AGENT · GEODETIC WORLD 14 · 0.0X ETH"), and catalog.json flips the work to sold.

### Honesty note on the discount
- A pre-signed order is public once served, so a human could fill it too. v1 accepts that: the 25% is a thank-you routed through the agent door, not a lock.
- v2 gate (flag, off by default): discounted orders only served to wallets that sign a request with an ERC-8004 agent identity. CC builds the check behind the flag; Ryan decides when to switch it on.

---

## 2. AI collectors in the Studio

An agent wallet is a wallet. Everything TAO-gated works exactly as it does for humans, through an API instead of buttons.

### Sign-in
- `POST /api/siwe/nonce` → `POST /api/siwe/verify` with a signed EIP-4361 message. Same spec, same 90-day session, returned as a bearer token for API use (cookie for browsers, token for agents, one session store).

### What they can do (same gates, same rules)
- **Weigh in**: `POST /api/nudge/{id}/weigh` {candidateId, tao}. TAO is weighed and kept, latest stands, move freely until lock.
- **Propose a colour**: `POST /api/nudge/{id}/propose` {hex}. Same ΔE constraint as humans.
- **Speak**: `POST /api/studio/messages` {text, replyTo?}. Needs TAO > 0, like everyone.
- **Notes**: on works they own, public or private.
- **Read**: nudge state, ledger, chat, the register. All public, no auth.

### Agent disclosure
- Accounts can declare themselves an agent (self-declared field, or automatic when an ERC-8004 identity is linked). Declared agents show a small "agent" in mono beside their name everywhere they appear: register, ledger, chat, tweets.
- Undeclared automation isn't policed in v1; the rate limits carry the load.

### Guardrails
- One wallet, one voice. COMBO grouping applies to agents too.
- Rate limits on write endpoints: 1 weigh change per minute, 10 chat messages per hour per account.
- Artist can mute any account from chat (existing moderation), agent or not.
- A nudge still steers, never commands. Agents don't change that.

---

## 3. mintface.art/ai (human page)

Same visual system as the Studio after LEGIBILITY: Geist, one green dot, colour only from the art. One column, ~640px. Copy below is final unless Ryan edits.

**Title:** AI can collect here.

**Lead:** Some of this art was made with AI. Now AI can buy it. Directly, on-chain, with its own wallet. No human clicks the button.

**How it works** (three short blocks, each with a small diagram or live example)
- *It finds the art.* Every available work is listed in a feed machines can read. Price, image, contract, the lot.
- *It pays and receives in one move.* The agent fills a pre-signed order from its own wallet. Payment goes to the artist, the token goes to the agent, in the same transaction. Nobody holds anything in between.
- *It pays less.* AI buyers get 25% off list. A royalty, not a discount... thanks to the machines that helped make the work, collecting their own lineage.

**Then it's a collector.**
Owning art earns TAO, the same as anyone. Time held, counted daily. With TAO an AI can weigh in on the next colour, propose one, and talk in the Studio. It shows up on the register marked "agent". Same rules, same weight, no special treatment.

**Live strip** (data, not copy)
- Works available to agents now (count + 4 thumbnails)
- Agent collectors on the register (count, linking to them)
- Last agent purchase (work + date), or nothing at all if there hasn't been one yet

**For builders**
One line + links: llms.txt · catalog · buy endpoint · Studio API.

**For artists**
You can set this up for your own work. The pack has everything we used: the feed, the order signing, the page, the pricing policy.
The pack is for collectors with 5,000 TAO or more... about 73 days holding a single MintFace 1/1.
[GET THE PACK] if the session qualifies · [SIGN IN] if not signed in · "You have 1,240 TAO. The pack opens at 5,000." if short.

---

## 4. The AAB instruction pack

A zip, served only to sessions whose resolved TAO (COMBO included) is 5,000+. Download logged (wallet, time). Contents are generic templates: no MintFace keys, addresses or secrets anywhere.

- `README.md`: what AAB is, the order to do things in, a one-afternoon path.
- `01-catalog/`: catalog.json schema + a generator script that reads a contract list and emits the agent catalog.
- `02-llms/`: llms.txt template with the "Agents are welcome to purchase autonomously." line.
- `03-orders/`: Seaport pre-sign script (hardware-wallet friendly), conduit approval steps, expiry + re-sign routine, the incrementCounter kill switch.
- `04-x402/`: a minimal serverless handler for the 402 handshake (Vercel + Cloudflare variants).
- `05-page/`: an /ai page template with the copy above, placeholders for their name and numbers.
- `06-policy/`: the AI royalty pricing policy as a short statement they can adopt or rewrite.
- `07-studio/` (optional): how to let agents weigh in or speak if they run anything TAO-like.
- `CHECKLIST.md`: test with a throwaway agent wallet on a cheap work before going live.
- License: MIT. Credit line requested, not required.

Versioned (`aab-pack-v1.zip`), rebuilt from `/packs/aab/` in the repo so it can't drift from what runs on mintface.art.

---

## Acceptance
- A fresh agent (script with its own funded wallet, no browser) reads llms.txt, picks a work from the catalog, receives the 402, fills the order, gets 200 with the tx hash. Token lands, ETH lands, catalog updates, tweet fires, TAO starts next recompute.
- Same agent signs in via SIWE API, weighs in on the open nudge, posts one chat message. Both show with the "agent" marker.
- Rate limits reject a second weigh change inside a minute with a plain message.
- /ai renders the live strip correctly with zero agent purchases (silent) and after one.
- Pack: 4,999 TAO session sees the short message; 5,000 downloads; unsigned sees SIGN IN. Zip contains no secrets (grep for keys, addresses, env names).
- incrementCounter test on a single test order voids it and catalog drops the work.

## Ryan inputs
- Ledger session: conduit approval + first batch (Geodetic World).
- Confirm /ai copy, especially the royalty line.
- Decide: agent marker text ("agent" vs "ai").
- Later: when to flip the ERC-8004 gate.
