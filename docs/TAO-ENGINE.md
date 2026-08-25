# TAO-ENGINE.md

TAO (Total Art Owned) as a public, open engine any artist can run. This is the cornerstone doc. Decisions below are locked unless marked open.

Depends on: TAO-INTEGRITY.md (the mintface cron fix). The engine inherits whatever that hardens. Do not fork the sweep+recompute until integrity lands.

---

## What TAO is

- Time-weighted patronage metric. Hold a work, earn TAO daily.
- Defaults: 69 TAO/day per 1/1 held. 4.2 TAO/day per edition copy held.
- Sold = the TAO that work earned you is subtracted.
- Plain transfer = you keep banked TAO, accrual stops, receiver starts at zero.
- Computed by daily full recompute from Transfer logs. Deterministic. Same inputs, same output, every time.
- TAO is the universal term. Not renameable per artist. The coinage travels with the engine.

---

## Sequence (locked)

1. **The Line demo page** on theline.wtf. Proves the engine on 1,000 artists' contracts.
2. **Public `tao-engine` repo**. Extracted, config-driven, MIT.
3. **Claude Skill installer**. SKILL.md that lets Claude Code deploy the engine for an artist end to end.

MintFace does NOT migrate onto the engine in this sequence. collectors.mintface.art keeps its own hardened instance. Migration is a later decision once the repo has run for others.

---

## 1. The Line demo page

### Purpose
Any Line artist sees their collectors ranked by TAO at default rates, no setup. Sells the idea by showing it on their own work.

### Behaviour
- Route: `theline.wtf/tao` (or `/tao/[artist-slug]`).
- Pick an artist from the 1,000. The Line already holds their contract addresses... no input needed.
- Renders their collectors ranked at 69/4.2 defaults. Sale/transfer classification as per mintface's engine. Default exclusions: the artist's own wallet, known marketplace and escrow contracts.
- Renders for all 1,000 by default. Not opt-in. An artist can request removal.
- Ryan's Etherscan key powers the demo. Server-side only, never in the client bundle.
- Each artist page carries a line: "Run this on your own site" → links to the repo (once public) and the Skill.

### Compute
- Cache per artist. Recompute on demand with a cooldown (e.g. once per 24h per artist, or on first view then daily).
- Do not sweep all 1,000 nightly on one key... rate limits. Lazy-compute on view, then schedule.
- Store per-artist run evidence (run_id, head_block, run_at, address_count, total_tao) so the page can show "computed at {time}, block {n}".

### Config source
The Line's existing artist records → mapped into the engine's config schema (below). Per-artist config = contracts list, artist wallet excluded, defaults for everything else.

---

## 2. `tao-engine` repo

### License
MIT. Fully open.

### Shape
Config in → JSON out. Plus a drop-in neutral leaderboard page. Nothing else.

```
tao-engine/
  engine/
    sweep.ts         recursive block-range getLogs, all Transfer events per contract
    classify.ts      sale vs transfer (marketplace-contract / consideration detection)
    recompute.ts     deterministic full recompute → per-address TAO
    head.ts          RPC head-block, throws on fallback
    evidence.ts      run-evidence record per run
  config/
    schema.json      v1 schema
    example.json
  page/
    index.html       neutral leaderboard, reads output JSON, zero brand
  output/
    tao.json         the artefact (gitignored in deployments)
  SKILL.md           the Claude Skill (see §3)
  README.md
```

### Engine behaviours (all inherited from the hardened mintface engine)
- **Sweep**: recursive block-range `getLogs` per contract. Split ranges on provider limits. Edition-aware per copy (ERC-1155 quantities, ERC-721 token ids).
- **Head block**: from RPC. If the RPC head is unavailable, throw. Never fall back to Etherscan's or a cached head. A wrong head silently corrupts every balance.
- **Classify**: sale if the transfer sits inside a known marketplace contract call or has detectable consideration (ETH/WETH movement in the same tx to the sender). Ambiguous → transfer. Conservative by design... a mis-classed sale subtracts someone's TAO wrongly, a mis-classed transfer just fails to subtract.
- **Recompute**: full, from block zero of each contract, every run. No incremental deltas. Deterministic.
- **Evidence**: every run writes `{run_id, run_at, head_block, contracts, address_count, total_tao, config_hash}`. Failed runs write a failure record, never partial totals.
- **Output**: `tao.json` with per-address `{address, tao, works_held, since}` plus the evidence header. Namespaced (see schema) so future cross-artist composition doesn't collide.

### Config schema v1 (locked)

```json
{
  "version": 1,
  "namespace": "mintface",
  "chain": "ethereum",
  "rpc_url": "...",
  "etherscan_key_env": "ETHERSCAN_KEY",
  "defaults": {
    "rate_1of1": 69,
    "rate_edition": 4.2
  },
  "collections": [
    {
      "address": "0x...",
      "label": "Geodetic Moments",
      "standard": "erc721",
      "rate_1of1": 69,
      "rate_edition": 4.2
    }
  ],
  "policy": {
    "on_sale": "subtract",
    "on_transfer": "keep"
  },
  "exclusions": {
    "artist": ["0x..."],
    "escrow": ["0x..."],
    "marketplace": ["0x..."]
  }
}
```

- `chain`: Ethereum only in v1. Field exists so v2 doesn't break the shape.
- `namespace`: totals are namespaced under this key in output. Anticipates cross-artist composition without implementing it.
- Per-collection rate overrides. Omit to inherit `defaults`.
- `policy.on_sale`: `subtract | keep`. `policy.on_transfer`: `keep | reset`. mintface = `subtract` / `keep`.
- `exclusions`: three lists, all optional. Marketplace list ships with sensible defaults (OpenSea Seaport, Blur, etc.) that the artist extends.

### Deferred to v2 (not in scope, do not build)
- Other chains (Base, Tezos, etc.).
- Time modifiers: decay, genesis bonuses, early-collector multipliers.
- Cross-artist composition (one leaderboard across several engines). Namespacing is the only concession.
- Wallet clustering.

### Leaderboard page
- Single static `index.html`. Reads `output/tao.json`. Zero brand, zero colour opinions beyond neutral.
- Rank, address (ENS if resolvable client-side, else truncated), TAO, works held, holding since.
- Header shows total TAO + evidence line (run time, head block).
- Artist replaces styling freely. It's a starting point, not a design.

### Deploy target
- Vercel by default (matches Ryan's workflow). Cron via Vercel Cron or GitHub Actions. Either is fine... the Skill picks based on what the artist has.
- Etherscan free-tier key is enough for one artist. Document the limits.

---

## 3. Claude Skill

`SKILL.md` teaches Claude Code to deploy the engine for an artist with no hand-holding.

### Flow the Skill drives
1. Ask: contract addresses (or a link to the artist's OpenSea/manifold page to derive them).
2. Ask: rates. Offer 69/4.2 as defaults. Explain what the numbers mean in one line each.
3. Ask: sale and transfer policy. Default subtract/keep. Explain the difference in one line.
4. Ask: exclusions. Artist wallet(s), any escrow. Marketplace defaults pre-filled.
5. Ask: Etherscan key (free tier) and RPC URL. Explain where to get them.
6. Write `config.json`. Validate against schema.
7. Run one recompute locally. Show the top 10. Confirm it looks right before deploying.
8. Deploy to Vercel (or wherever). Wire cron. Confirm first scheduled run wrote evidence.
9. Hand back: leaderboard URL, evidence URL, how to change rates later.

### Skill rules
- Never store or echo keys. Env vars only.
- Never deploy without the artist seeing one local run first.
- Never rename TAO.
- If head-block throws, stop and explain. Do not work around it.

---

## Open items

- **mintface cron reliability** (TAO-INTEGRITY.md, with CC). The engine repo waits on this. Whatever fixes the cron is what gets extracted.
- Demo route naming on The Line (`/tao` vs per-artist).
- Whether the demo page should show the "Run this on your own site" line before the repo is public. Probably hold the link, keep the line.
