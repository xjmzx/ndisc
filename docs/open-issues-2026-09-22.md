# Known limitations & open issues

> Recorded 2026-09-22, after the session that built the three checks. Each
> entry is a thing the tooling **cannot** currently see or do, written down so
> it is a known gap rather than a surprise later.

---

## The three checks, and what each is blind to

ndisc now has three independent checks. They answer different questions, and
each has a blind spot the others cover — or don't.

| check | question | blind to |
|---|---|---|
| **style lint** (rules in `schema/title-styling-2026-09-22.md`) | is this value well-formed? | whether it matches disk or the wire |
| **tag/DB drift** (scan → drift review) | does the catalogue match the files? | anything published |
| **content audit** (Maintenance → Audit published content) | does the wire match the catalogue? | a *single relay's* gap — see below |
| **relay audit** (Maintenance → Reconcile relays) | which relay has what? | *which* releases are stale — see below |

### 1. The content audit unions the relay set

It takes the **newest event across all relays**, so one relay serving a stale
or missing copy is invisible when another relay is correct. That is right for
a reader (they union too) and wrong for a hub.

Concretely, on 2026-09-22 `relay.fizx.uk` was missing 21 releases and serving
an outdated copy of 3 more, all published in a 3-day window in late July. The
content audit read **clean** throughout, because `nos.lol` had every one. Only
the relay audit saw it.

**Use both.** Content audit says *what* is wrong; relay audit says *where*.

### 2. The relay audit reports `stale` as a count, not a list

`RelayAuditRow.orphans` and `.missing` are `Vec<i64>` and drive real actions
(purge, re-publish). **`.stale` is a bare `usize`.** So the UI can say a relay
is serving 3 outdated copies but never which, and they cannot be fed to the
queue action the way orphans and missing can.

The three found on 2026-09-22 were identified only by probing each relay
separately from the command line. Making `stale` a `Vec<i64>` like its
siblings would close this; it was judged not worth doing while it is rare.
**If a relay starts dropping writes regularly, do this first.**

### 3. Nothing sees a track title

Track titles are not part of `kind:31237`, so the content audit cannot see
them. ndisc never reads them, so the drift chip cannot either. And **nplay's
per-track editor writes `TITLE` / `TRACKNUMBER` straight to the file** with no
styling rule applied — a second mutation path in the suite (see
`file-data-handling-2026-09-22.md`).

This is a **deliberate** limit, not an oversight: a track title cannot diverge
from the wire, because it is never on the wire. The cost is bounded to
cosmetics inside nplay. It is recorded because the reasoning matters — four
remix credits in this library spelled an artist with a micro sign, in exactly
that field.

## Relay behaviour

- **`relay.primal.net` retains only recent writes.** On 2026-09-22 it served
  178 of 1,898 releases, all published that day. This is retention policy, not
  a publishing failure, and there is nothing to fix. Open question: whether it
  earns a slot in the relay list when it behaves as a short-lived cache rather
  than a mirror.
- **An additive contract tag strands every already-published release.** `discs`
  arrived in the 2026-06 round; 47 releases still carried events without it
  months later, because nothing local had changed and so nothing ever marked
  them stale. Republishing the stale queue can never reach that class — only
  the content audit can find it. **Plan a content audit + queue pass into every
  additive contract change.**

## Catalogue

- **142 releases have never been published.** Not a defect; recorded so the
  number is understood when reading `1,898 published of 2,040`.
- **Cross-platform behaviour is largely unverified** — macOS decomposition,
  NTFS case-insensitivity, tag writing off Linux. Listed with a test for each
  in `file-data-handling-2026-09-22.md`.
