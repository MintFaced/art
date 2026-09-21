# TWEET-BOT — the studio wire

An X bot tweeting the studio's life in real time: every nudge, every weigh-in, every sale. Mono-terse house voice, generated image on every tweet, collectors tagged for recognition. The feed teaches what Strip Paintings are becoming, one weigh-in at a time.

## Events — tweet all, no filtering
1. **Nudge opens**: "NUDGE #3 · WEIGH IN ON THE THIRD COLOUR · CLOSES 28 SEP '26" + image: pottle row as it stands (locked colours filled, open slot marked OPEN) + mintface.art/studio link.
2. **Colour proposed**: "≈ POWDER BLUE PROPOSED BY @0xunix · NUDGE #3" + image: the new swatch beside the locked palette strip.
3. **Weigh-in** (every one, including changes/moves... latest act tweeted as it happens): "@piercedcat PUT 100,000 TAO 🧧 BEHIND ≈ LIGHT GREEN" — moves read "@keyrun MOVED 13,749 TAO TO ≈ ORCHID". Image: backed swatch + locked palette + running total on that candidate.
4. **Nudge locks**: "LOCKED · ≈ LIGHT GREEN · 627,000 TAO · 4 COLLECTORS · COLOUR 2 OF 12" + image: the pottle row with the new fill. If Ryan uploads the mixed-jar photo, a follow-up tweet carries it: "MIXED IN THE STUDIO" + the pot.
5. **Sales**: always price, always collector: "COLLECTED · GHOST · TWO BURDENS · 0.3 ETH · @handle" (name-only where no handle). Image: the work's existing OG card. Fires from the sale webhook/sweep for every path — site, OpenSea, agent rail when it lands.

## Tagging + naming
6. Handles from the collector overlay data (the new X-handle field); tag when known, display name when not. An opt-out flag in the overlay is respected silently — no tag, no name if they ask. TAO figures always tabular, 🧧 is the TAO glyph in bot voice.

## Voice
7. Mono-terse: caps, · separators, no hashtags, no exclamation marks, no emoji beyond 🧧 and the odd 🍒. Link only when there's somewhere to go (open nudges → /studio, sales → the work page). Ryan supplies nothing per-tweet — templates carry the voice.

## Images
8. Extend the Satori/OG pipeline: a tweet-card variant (1200×675) — warm white, swatch(es) large, locked-palette strip, mono caption, coordinates footer. Locked hexes render flat and exact; no gradients ever.

## Plumbing
9. Event queue: nudge ledger writes + sale events push to a queue (KV/store table); a worker drains to the X API in order, marking sent — no double-tweets on retry, no missed events on failure (the queue is the truth, the timeline is the render).
10. X API: Ryan creates the bot account + developer app; four credentials into Vercel env vars (CC names them). Tier per observed volume — start free-tier caps, report if weigh-in volume demands the paid tier.
11. Rate/burst safety: if the queue backs up past X's limits during a hot hour, drain in order with spacing — late beats lost. Never summarise; tweet-all stands.
12. Kill switch: a single env flag pauses the worker (queue keeps accumulating) — for the day something misfires publicly.

## Sequencing
13. Ship sales + nudge-open/lock first; weigh-ins + proposals the day after (they're the volume). **The bot's first tweet is Nudge #3 opening** — clean origin story. Backfill nothing; the feed starts when it starts.

## Acceptance
14. Nudge #3 opens → tweet with pottle-row image lands. A test weigh-in → tweeted with tag within a minute. A 4242 sale in test → queued, not tweeted (test-mode events never reach the timeline — verify the guard). A real sale → tweeted with price + collector. Opt-out flag → silent. Kill switch → queue grows, timeline quiet, resume drains in order.

## Ryan inputs
- The bot handle (create the X account) + developer app credentials into env vars.
- Confirm Nudge #3 close date for the first tweet's copy.
- Optional: the Nudge #2 jar photo, so the lock announcement gets its follow-up.
