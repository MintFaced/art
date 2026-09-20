# ACTIVITY — two kinds of alive

The register could always say what somebody holds and what it is worth, and
nothing at all about whether they are still there. Two different questions hide
inside that one, they want answers from different places, and conflating them
would make both useless.

```
on chain      when this wallet last sent a transaction, anywhere, of any kind
in the room   whether they have been in the MintFace Studio lately
```

A wallet that trades daily and has never spoken is not the same as one that has
not moved in a year and weighed a nudge this morning. So they are two files,
two signals, and one row.

## On chain — LAST ACTIVE

`data/last-active.json`, written by `api/cron/active.js`. A column on the
register and a line on a collector page, showing a month.

**txlist, not tokentx, and that is the whole point.** `txlist` is what a wallet
*sent*. Being sent something is not evidence that anybody is home — an airdrop
lands on the dead as easily as on the living. The question is whether this
wallet still acts, so the answer is built only from its own acts.

**Sorted both ways on purpose.** Descending answers "who is still out there".
Ascending answers the question underneath it — which wallets have gone quiet,
dormant, or are lost — and that one has no other way to be asked. A wallet with
no transaction at all sorts to whichever end is the quiet one, because `0` is
not a date, it is the absence of one.

### Why it is tiered rather than nightly

Three and a half thousand addresses, one lookup each, against a free tier that
allows five calls a second, is twelve minutes. The function has five. So:

| tier | who | how often |
|---|---|---|
| 1 | the ~800 collectors with a page | every night |
| 2 | everyone else | rotating on a cursor, ~3 days round |

The wallets anybody actually opens are never more than a day old. The tail is
well inside the month the column displays, so the lag cannot be seen in it.
`cursor` in the file is where tier 2 resumes; it only advances by what the run
actually got through, so a short night costs nothing but time.

If the sweep is ever given a longer budget — `ACTIVE_SWEEP_MS`, bounded by the
function's `maxDuration` — it covers more of the tail per run with no other
change. Nothing else needs to know.

A wallet the sweep has not reached yet is written as nothing, never as never.
An empty column and a dead wallet are different facts and must not read alike.

## In the room — the green dot

`data/studio-active.json`, same cron, no chain lookup at all. Any collector who
weighed a nudge, said something, reacted or left a note inside the last thirty
days gets the site's single green dot beside their name, on the register and on
their own page. Hovering it names the most recent act: `ACTIVE IN THE STUDIO ·
WEIGHED 3 DAYS AGO`.

It is the availability-dot dialect applied to people. A collector page says a
painting is available with that dot; the register says somebody is in the room
with the same one. There is one green on this site and this is it.

**Never drawn for a private collector.** Being in the room is theirs to
disclose, exactly as a name is.

**Recomputed whole every night, not stamped at the time of the act.** A counter
written on every studio write is one more thing that can be missed, and a miss
in that design is permanent. This one can be wrong for at most a night, and
then it is right again on its own.

Every walk is bounded by the window rather than by the size of the archive: the
room is read newest-first and stopped at the first thing older than thirty days.
Notes are read from the per-wallet sorted sets rather than the public stream,
because `notes:all` carries only what is public and a private note is somebody
being in the room exactly as much as a public one is — and a note's id opens
with the millisecond it was written, so the newest id dates it without any body
being fetched. Nothing private is ever read to decide whether a dot is lit.

## The filter

The register's control row gains **Active in Studio**, which takes rows away
rather than reordering them, so it sits apart from the sorts and keeps the dot
it filters on, lit only while it is doing something. Combined with the TAO sort
it is the inner-circle view: who is holding, and who is here.

## When it runs

22:30 UTC, after the register is rebuilt at 21:30 — it reads that register to
know who to ask about, so it has to go last.

| env | default | what |
|---|---|---|
| `STUDIO_WINDOW_DAYS` | 30 | how long somebody stays lit |
| `ACTIVE_SWEEP_MS` | 235000 | budget before the writes |
| `ACTIVE_PACE_MS` | 205 | between Etherscan calls |
| `ACTIVE_MAX_GAP_HOURS` | 36 | a daily schedule with a run missing |

Run records are in `data/active-runs.json`, sixty kept, failures included.
