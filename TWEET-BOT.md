# TWEET-BOT — the studio wire

An X bot tweeting the studio's life in real time: every nudge, every weigh-in, every sale. Mono-terse house voice, generated image on every tweet, collectors tagged for recognition. The feed teaches what Strip Paintings are becoming, one weigh-in at a time.

## Events — tweet all, no filtering
1. **Nudge opens**: "NUDGE #3 · WEIGH IN ON THE THIRD COLOUR · CLOSES 28 SEP '26" + image: pottle row as it stands (locked colours filled, open slot marked OPEN) + mintface.art/studio link.
2. **Colour proposed**: "≈ POWDER BLUE PROPOSED BY @0xunix · NUDGE #3" + image: the new swatch beside the locked palette strip.
3. **Weigh-in** (every one, including changes/moves... latest act tweeted as it happens): "@piercedcat PUT 100,000 TAO 🧧 BEHIND ≈ LIGHT GREEN" — moves read "@keyrun MOVED 13,749 TAO TO ≈ ORCHID". Image: backed swatch + locked palette + running total on that candidate.
4. **Nudge locks**: "LOCKED · ≈ LIGHT GREEN · 627,000 TAO · 4 COLLECTORS · COLOUR 2 OF 12" + image: the pottle row with the new fill. If Ryan uploads the mixed-jar photo, a follow-up tweet carries it: "MIXED IN THE STUDIO" + the pot.
5. **Sales — on-chain ETH only in v1**: OpenSea fills, the site's ETH path, the agent rail when it lands. Stripe/fiat sales never tweet (gate on the payment path the sweep/webhook already records). Always price, always collector: "COLLECTED · GHOST · TWO BURDENS · 0.3 ETH · @handle" (name-only where no handle). Image: the work's existing OG card. Stripe as a possible v2 with different copy, only if Ryan ever asks.

## Tagging + naming
6. Handles from the collector overlay data (the new X-handle field); tag when known, display name when not. An opt-out flag in the overlay is respected silently — no tag, no name if they ask. TAO figures always tabular, 🧧 is the TAO glyph in bot voice.

## Voice
7. Mono-terse: caps, · separators, no hashtags, no exclamation marks, no emoji beyond 🧧 and the odd 🍒. Link only when there's somewhere to go (open nudges → /studio, sales → the work page). Ryan supplies nothing per-tweet — templates carry the voice.

## Images
8. Extend the Satori/OG pipeline: a tweet-card variant (1200×675) — warm white, swatch(es) large, locked-palette strip, mono caption, coordinates footer. Locked hexes render flat and exact; no gradients ever.

## Plumbing
9. Event queue: nudge ledger writes + sale events push to a queue (KV/store table); a worker drains to the X API in order, marking sent — no double-tweets on retry, no missed events on failure (the queue is the truth, the timeline is the render).
10. X API: credentials are LIVE in Vercel Production env vars — X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET (OAuth 1.0a user context, read-write, generated under the bot account). Production only; Preview deliberately has none — branch deploys must never tweet. Start on free-tier caps; report if weigh-in volume demands the paid tier.
11. Rate/burst safety: if the queue backs up past X's limits during a hot hour, drain in order with spacing — late beats lost. Never summarise; tweet-all stands.
12. Kill switch: a single env flag pauses the worker (queue keeps accumulating) — for the day something misfires publicly.

## Sequencing
13. Acceptance first (one throwaway tweet to prove the pipe, then delete it). Ship sales + nudge-open/lock, then weigh-ins + proposals (they're the volume). **The bot's first real tweet is Nudge #2 locking, the second is Nudge #3 opening** — the account announces itself mid-story. Backfill nothing; the feed starts when it starts.

## Acceptance
14. Throwaway tweet lands and is deleted. Nudge #3 opens → tweet with pottle-row image within a minute. A test weigh-in → tweeted with tag. A Stripe or test-mode sale → skipped or queued-unsent, never tweeted (verify both guards). A real ETH sale → tweeted with price + collector. Opt-out flag → silent. Kill switch → queue grows, timeline quiet, resume drains in order.

## Ryan inputs
- DONE: bot account, developer app, four credentials in Production.
- Confirm Nudge #3 close date for the opening tweet's copy.
- Optional: the Nudge #2 jar photo, so the lock tweet gets its "MIXED IN THE STUDIO" follow-up.
