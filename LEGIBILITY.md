# LEGIBILITY — the Studio, read at a glance

The problem: everything speaks in the same voice. Mono caps, 12–13px, light grey, wide tracking, hairline dividers. When everything is a label, nothing is the headline. The colours, the whole point, are the smallest things on the panel.

The fix: three tiers, applied everywhere.
1. **Colour** is the hero. Big, first, unmistakable.
2. **Numbers + actions** are secondary. Clear, tabular, one button per decision.
3. **Metadata** is quiet, and much of it only appears on demand.

---

## Nudge panel

### Remove
- "A nudge steers. It never commands. The studio may act with, against, or without the result." Move it to a single (?) beside the title that opens it as a tooltip, or to /about.
- "COLOUR PROPOSED. WEIGH TAO BEHIND ANY ON THE BOARD." The buttons already say this.
- "LOCK · 1 OF 5 COLLECTORS · 69K OF 500K TAO ON THE LEADER". It repeats the two bars under it.
- The separate YOUR WEIGH-IN block. It gets merged into the card you backed (below).

### The palette strip (new hero, top of panel)
- Full-width band of 12 equal segments. Locked colours are filled solid. The open slot for this nudge is outlined, labelled "3", and shows the current leader's colour faintly (a live preview). The rest are empty.
- Height ~48px desktop, ~40px mobile. This replaces COLLECTOR CHOSEN. Hex + Pantone name appear on hover/tap of a segment.
- It is the pottle row, flattened. The same object everywhere.

### Candidates become colour tiles
- Each candidate is a card led by a large swatch: full card width, ~120px tall desktop, ~96px mobile. The swatch's left edge carries thin bands of the locked colours, so the tile previews the palette as it would be.
- Under the swatch: name in Geist sans, sentence case, 18px ("Violet", "Pantone Cool Gray 7 C"). Hex hidden until hover/tap.
- TAO total in mono 20px, right aligned. A thin bar under it, proportional to this candidate's share of the leader's TAO. The race becomes visible.
- "by carlos28355.eth" at 13px, quiet, still a link.
- One button: WEIGH, or CHANGE if it's yours.
- Two candidates side by side on desktop, stacked on mobile.

### Your weigh-in, on the card
- The card you backed gets a 2px ink outline and a line inside it: "Yours · 69,000 TAO". CHANGE lives there.
- Weighing opens inline on that card: amount field (defaults to all available) + WEIGH IN. Available TAO shown only here, at the moment it matters.
- COMBO · 2 WALLETS stays as a quiet link beside the amount.

### Progress to lock
- Voters as 5 dots that fill (● ● ○ ○ ○), not a bar. Five is small enough to count at a glance.
- TAO on the leader as one bar with a tick at 500K.
- Both on one row, labelled once: "To lock".

### Header
- Title stays: "Weigh in on the third colour."
- One subline: "Nudge #3 · closes tomorrow". Relative time under 7 days, date beyond.

### Ledger
- Collapsed by default: "2 collectors · 138,000 TAO" as a toggle. Expanded view unchanged.

---

## Chat

- **Author line**: name in Geist sans semibold 15px. TAO beside it in mono 12px. Role ("the artist") as quiet mono. Time right aligned, relative for today ("2h"), date beyond.
- **Controls on demand**: REPLY, REACT and the × – controls appear on hover (desktop) or tap/long-press (mobile). Never resting on screen.
- **No divider lines** between messages. Separate them with space: 24px between authors, 6px between consecutive messages from the same author.
- **Group runs**: consecutive messages from the same author within 10 minutes share one author line.
- **Measure**: message text max 65 characters wide (~620px at 17px). Long lines are the biggest reading tax on the left column right now.
- **Replies**: replace "↳ REPLYING TO 0XUNIX.ETH" with a one-line quoted snippet of the parent (grey left rule, truncated). Clicking it scrolls to the parent.
- Reactions and link previews: keep as is.

---

## System rules (both surfaces)

- **Contrast**: the light grey on warm white is roughly 2.7:1. Metadata goes to at least 4.5:1 (around #6B6A64). Placeholder and disabled text are the only things allowed lighter.
- **Minimum size**: 13px anywhere, 15px for anything read as a sentence.
- **Tracking**: mono caps at +0.04em max below 14px. The current wide tracking at small sizes slows reading.
- **Mono caps are for data and short labels only.** Names, messages and sentences are Geist sans, sentence case.
- **Spacing**: 8px grid. Gaps between groups at least 2× the gaps inside them. Hairlines only where there is no space to separate things.
- **Hit targets**: 44px minimum on mobile for every button and tappable row.
- **One accent**: the green dot stays the only UI colour. Everything colourful on the page is the art.

---

## Acceptance
- Squint test: blur the page. The palette strip and candidate swatches are the first things you see; the leader is obvious.
- A collector who has never been here can weigh in without reading any sentence on the panel.
- Word count on the nudge panel drops by at least half.
- All metadata passes 4.5:1. All mobile targets are 44px or more.
- Mobile screenshot of the panel fits palette strip + both candidates above the fold.
