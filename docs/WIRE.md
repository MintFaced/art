# WIRE — the studio bot

An X account tweeting the studio's life as it happens: a nudge opening, a
colour proposed, every weigh-in, a lock, a sale. Nothing summarised, nothing
filtered. See `TWEET-BOT.md` for the brief this implements.

## The queue is the truth, the timeline is the render

Events are written the moment they happen, by whatever wrote them — a route, a
cron, the chain sweep — and a worker drains them to X afterwards. That split is
the whole reliability story:

- **Posting cannot fail a weighing.** `enqueue()` never throws. A tweet that
  cannot be queued is a dropped tweet; a dropped weighing is a different day.
- **A retry cannot double-tweet.** Sending is recorded against the event id
  before the next one starts.
- **An outage at X costs lateness, not events.** The worker stops at the first
  thing it cannot send rather than stepping over it, because a feed where a
  lock appears before the weigh-in that carried it tells the story backwards.
  Late beats lost; out of order is worse than late.

| key | what |
|---|---|
| `wire:q` | ids waiting, oldest first |
| `wire:e:<id>` | the event |
| `wire:sent` | id → what X gave back. The dedupe. |
| `wire:dead` | id → why it will never send |

## Sales are on-chain only

v1 tweets **ETH sales only** — OpenSea fills, the site's ETH path, the agent
rail when it lands. Stripe and the other fiat paths never tweet.

This is a property of *where the event is raised*, not a filter that could be
got wrong: the sale event comes from the movements loop in `api/cron/tao.js`,
which only ever sees on-chain transfers the classifier called a sale. Stripe's
webhook has no access to the wire at all, and a check in `test-wire.mjs` holds
it that way.

**A sale we could not price is not tweeted.** "Always price" is the rule and a
figure invented to satisfy it would be the worst possible way to keep it. The
classifier now reads the transaction as well as the receipt: native ETH is the
value on the transaction, and a WETH sale moved no ether at all, so the figure
is what reached the seller.

## The voice

Mono-terse. Caps, `·` separators, no hashtags, no exclamation marks, 🧧 for TAO
and nothing else by rule. Templates carry it; Ryan supplies nothing per tweet.
The rules are enforced in `speak()` and checked in the suite, because a stray
hashtag gets in via a template added in a hurry.

```
NUDGE #3 · WEIGH IN ON THE THIRD COLOUR · CLOSES 28 SEP '26
≈ LIGHT GREEN PROPOSED BY @0xunix · NUDGE #3
@piercedcat PUT 100,000 TAO 🧧 BEHIND ≈ LIGHT GREEN
LOCKED · ≈ LIGHT GREEN · 627,000 TAO 🧧 · 4 COLLECTORS · COLOUR 2 OF 12 · LOCKED BY THE ARTIST AT 4 OF 5 VOTERS
COLLECTED · GHOST · TWO BURDENS · 0.3 ETH · @piercedcat
```

**The artist-lock honesty travels onto the timeline.** A colour the studio
locked over the thresholds would otherwise read as a plain LOCKED, and a feed
is the one place a claim like that spreads beyond the people who were there.

**Colour names come from `api/_lib/palette.js`.** The table was browser-only;
it is canonical server-side now and `mintface.js` keeps a copy, with a check
holding the two identical. A feed calling a swatch one thing and the page
calling it another is the fault that prevents.

## Naming, and being left alone

Handle from the collector overlay's `x` field; display name where there is
none. `"quiet": true` on a collector in `data/source/collector-overlay.json`
means **no tag and no name**, silently — a tweet saying somebody declined to be
named is still a tweet about them. Their act is still tweeted, unattributed: *A
COLLECTOR PUT 5,000 TAO 🧧 BEHIND ≈ LIGHT GREEN*. A collector the register
marks private gets the same treatment without having to ask.

## The card

1200×675, not 1200×630: X crops 1.91:1 and does not crop 16:9, and a swatch
with its edge shaved off is a lie about the colour. Locked hexes render flat
and exact — no gradient, no shadow, no rounding — because this image is the
closest most people come to seeing the paint.

Rendered by `/api/og?wire=1`, from the query alone, so a draining queue never
stampedes the register. **The picture is best effort and the words are not**: a
card that will not render must not cost the tweet.

## Running it

| env | what |
|---|---|
| `X_API_KEY` / `X_API_SECRET` | the developer app |
| `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` | the bot account's own tokens |
| `X_BOT_PAUSED` | **the kill switch.** Set it and sending stops; the queue keeps filling. |
| `WIRE_BATCH` | tweets per run, default 8 |
| `WIRE_SPACING_MS` | between tweets, default 2500 |

OAuth 1.0a user context, signed in `api/_lib/x.js` with node's crypto — a
bearer token speaks for the app and this has to speak for the bot.

The worker is `/api/cron/wire`, every minute. `?dry=1` composes everything and
sends nothing, which is how to read what the feed would say before it says it.

**The kill switch loses nothing.** Pulling it costs the timeline its lateness
and costs the record nothing, because the queue is still the truth.
