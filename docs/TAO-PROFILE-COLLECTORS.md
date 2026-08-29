# TAO-PROFILE-COLLECTORS.md

Add a `The Collectors` section to every Line artist profile page. Rollout to all profiles at once... this is a page template change reading data that already exists, not a per-artist job.

## Placement

- Section order becomes: `I. The Artist` → `II. The Works` → `III. The Collectors` → `IV. The Line`.
- Header is **The Collectors**, big, matching the existing section header treatment exactly (serif, roman numeral, spacing)... same visual weight as The Works and The Line.

## Content

**One-sentence TAO explainer**, small text under the header:

> TAO — Total Art Owned — accrues daily to every wallet holding this artist's work: 69 a day per 1/1, 4.2 per edition copy. Sold subtracts, given keeps.

Exact copy above. No link-out to docs, no second sentence.

**Top 10 by TAO**, identical row treatment to the live board page:
- rank, avatar, label (ENS → 6529 handle → truncated address), 6529 pill / X mark where resolved, THE ARTIST tag where applicable, TAO, `1/1 · ED` split, since.
- No expandable rows here... that stays on the board page. Rows still link out to the collector's OpenSea profile.

**Button** below the ten:
- Label: `ALL COLLECTORS →`
- Style: the existing gold-outlined box button used for `ENTER THE LINE 77 BY APOCALYPSE →`... same border, letterspacing, arrow, hover. Reuse that component, don't restyle.
- Target: `/artists/{slug}/tao`.

## Data

- Read the same `tao.source` object the board page reads. Top 10 = first ten rows, already sorted. No new fetch shape, no new engine work.
- Fetch client-side or at request time, same as the board... profiles must not need a rebuild when boards update nightly.

## States

- No `tao.source` on the artist record (no board yet): render The Collectors with the explainer sentence and `Collector rankings are being prepared for this artist.`... same voice as the Works placeholder. Never hide the section entirely, never 404, never an empty table. No button in this state.
- Board stale (>36h by `run_at`): render normally. Staleness signalling lives on the board page, not here.

## Duplication note

Section I already has `115 COLLECTORS, RANKED BY TIME HELD →` pointing at the same board. Leave it for now... remove in a later pass if it reads as clutter once Collectors is live. Don't spend time on it.

## Acceptance

- Check three profiles: one full-data artist (apocalypse), one names-but-no-holdings fleet artist, one no-board artist.
- Numbers on the profile top 10 match the board page exactly for the same artist.
- Section renders on mobile without the table breaking.
