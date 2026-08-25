# TAO-TOTALS.md

Scope: collectors.mintface.art. Two small additions on top of the live TAO engine. No engine changes. Read TAO-INTEGRITY.md first... this doc assumes the daily recompute is trustworthy.

---

## 1. Index header: site-wide TAO total + daily delta

### What it shows

`TAO 71,876,038 · +0.09% TODAY`

- Total = sum of current TAO across every address on the register (post-recompute, post-exclusions, post-sale-subtraction).
- Delta = % change run-over-run, against the previous stored total. Not a 24h clock window... the previous *run*.
- Negative days are shown honestly: `−0.42% TODAY`. No clamping, no hiding, no "steady" euphemism.
- First run ever: show total only, no delta.

### Storage

Add a `tao_totals` table (or Redis key list, whichever the recompute already writes to):

```
run_id        text   pk   (same run_id the recompute already stamps on evidence)
run_at        timestamptz
head_block    bigint
total_tao     numeric
address_count int
```

- One row per successful recompute. Failed or aborted runs write nothing here.
- Delta = `(latest.total_tao − previous.total_tao) / previous.total_tao`.
- If the previous row is missing or zero, omit the delta.

### Rendering rules

- Integer formatting with thin-space or comma thousands, matching the register.
- Two decimal places on the %. Sign always shown (`+`, `−`).
- Label is `TODAY` in caps, small. Tooltip or `title` attr: "Change since last recompute at {run_at, NZ time}."
- Header reads from the stored row, never recomputes on request.

### Edge cases

- Recompute skipped (head-block guard threw): header keeps showing the last good row. Add `· STALE` if `run_at` is older than 36h.
- Exclusion wallets: excluded from total, same as the register.
- Rounding: sum the unrounded per-address TAO, round once at the end.

---

## 2. /activate page

### Who lands here

Any address that has TAO on the register but no profile. Profile-less rows on the register link to `/activate`. Also linkable from chat/notes gating messages ("you need a profile to post").

### Core message

Your TAO accrues already. A profile activates by acquiring.

- You don't sign up. You don't fill in a form. You buy a work, the profile exists.
- If you already hold and have TAO, the profile is one acquisition away... or already exists if you've bought direct from mintface.art.

### Page sections

**Hero**
- Headline: "Your TAO is already counting."
- One line: holding MintFace work earns TAO every day, whether or not you have a profile. Acquire to activate.

**Where to acquire (live)**
- Pulled from the mintface.art commerce layer, not hand-maintained.
- Per collection with available work: name, count available, from-price (NZD/USD/ETH per site setting).
- Sold-out collections not listed here... link to secondary (OpenSea) in a footer line instead.
- Cache 10 min. Empty state: "Nothing listed right now. Secondary market still earns TAO."

**How TAO is calculated**
- 69 TAO per day per 1/1 held.
- 4.2 TAO per day per edition copy held.
- Sell a work: the TAO it earned you is subtracted.
- Transfer a work (no sale): you keep what you banked, accrual stops, the receiver starts at zero.
- Artist, escrow and marketplace wallets don't accrue.

**When it's calculated**
- Once daily, full recompute from chain. Show last run time (NZ) from `tao_totals.run_at`.
- "Balances update after the daily run, not on the block."

**What TAO unlocks**
- Rank on the register (default sort).
- Chat: any TAO.
- Notes on any work: 69,000+ current TAO.
- Nudges: weigh your TAO on studio questions.

### Copy voice

RWI. No em-dashes, ellipses fine. Fragments fine. No "unlock your journey" language.

### Not in scope

- Wallet-connect on this page. It's informational. Connect happens where the gate is.
- Any change to rates, policies or the recompute.
