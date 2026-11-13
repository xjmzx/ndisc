# Backlog

Planned ndisc work that is agreed in outline but not started. Each entry says
why, what, and what is still open. Remove an entry when it ships (the
CHANGELOG takes over from there). Suite-level direction stays in
[`SUITE.md` § Direction / roadmap](../SUITE.md); known blind spots of the
existing checks are in [`open-issues-2026-09-22.md`](open-issues-2026-09-22.md).

## Local covers vs Blossom: report what it cannot compare (planned 2026-11-13)

**Why.** The check (0.6.20) compares a published release's cover file with the
image its event points at, by the SHA-256 in the Blossom URL. Two kinds of
published cover fall outside that and are currently skipped without a word.
The 600 px tidy of 2026-11-13 found one of each by hand, not through the app:

- *Glow Stars* (Heather Nova) was published from `i.nostr.build` at 1000×1000
  while the file on disk was already 600×600. Its URL has no Blossom hash, so
  the check skipped it.
- *The First Connect EP* (Konny Kon & Chuck Nubian) is published at 808×808
  and has no file in the library (a physical release), so there was nothing to
  compare.

ncover cannot find either. It only reads the library, and in both cases the
problem is on the published side. Only ndisc knows what is published.

**What.** Two more groups in the check's result, beside "differ" and "same as
published":

1. **Published from elsewhere**: the cover URL is not on the primary Blossom
   server. Show the host, the published size and the local file's size. The fix
   is the per-release upload, or the batch upload, of the local file. Where
   there is no local file, the fix is "Move covers to Blossom".
2. **Published with no local file**: no `cover_art_path`, or it no longer
   resolves. Show the published size (one ranged read, as the sizing pass
   does). Nothing to upload; flag it when it is over the size the library is
   kept to, or not square.

Both lists go into the export below.

**Open.** Whether the "size the library is kept to" (600 px today) becomes a
setting in ndisc, or is only shown for the operator to judge.

## Local covers vs Blossom: Export list (planned 2026-11-13)

**Why.** It is the first step of the cover review loop shared with ncover, set
out in [ncover's `docs/backlog.md`](https://github.com/xjmzx/ncover/blob/main/docs/backlog.md).
ndisc says which covers differ from what is published, and ncover reviews and
fixes the files.

**What.** An **Export list** button on the check's result. It writes a text
file with one release folder per line, with further tab-separated columns:
artist — title, disk size, published size, and the group or kind (shrunk,
published copy is larger, different picture, published from elsewhere,
published with no local file). ncover's planned `From a list…` scope reads it.
The key is the release **folder**, as in `published.json`, never a database id,
so ncover stays a reader of what ndisc exports and the file is usable by hand.
Releases with no folder (physical) still get a line, keyed by artist — title,
for the operator. ncover will skip them.
