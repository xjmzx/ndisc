# A Nostr-connected player (design note)

> **Status: EXPLORATORY (2026-09-30): an idea, not a plan. No code, no wire
> change.** Written up loosely from a conversation, and expected to move. It
> lives here because it touches several suite apps (ndisc, nplay, nview and
> the signer), not one. Anything that becomes a contract change goes through
> SUITE.md and the schemas in this directory as usual.

## The idea in one paragraph

A music player in the spirit of VLC: something that decodes the files you
give it and plays them, with a Nostr connection on top. What goes to Nostr is
the **skeleton** of a release: artist, title, cover, discs and tracks. Never
the audio. You map your own library, which lives on your desktop, to those
skeletons, curate it, and share the curation. Separately, and privately, you
carry a few albums on your phone and listen to them there.

**It is not file sharing.** It is publishing on Nostr, plus a way to map a
library on a user's desktop to what they publish.

## Positioning (open questions)

Added 2026-09-30. None of this is settled; it's the direction the idea
leans.

- **Music first, everything else as the aside.** Most platforms that straddle
  audio are podcast-first, then live streams, with music as an aside. This
  leans the other way: artists, releases and live audio at the centre, with
  spoken word, field recordings and other audio fitting around them. The
  difference is less about which content shows up first than about which
  structure everything is built around. Podcast platforms are organised
  around shows and episodes. This would be organised around the **release
  and the artist**.
- **The skeleton already allows for it.** `release.v2` has a `type` field
  that's already a closed list: `music`, `sample`, `stem`, `field-recording`,
  `message`, `other`. A field recording or a spoken piece can already be a
  release, with the same skeleton, rights mark, rotation and open-release
  path. "Other audio" needs no new design, only use.
- **Live has a place.** Nostr's NIP-53 live events (kind 30311) can announce
  that an artist is streaming now and link the stream. In a music-first
  player that reads as a live release: the artist is on, right now. Shown
  alongside their releases, not as a separate section.
- **Radio stays with ntune.** ntune already tunes internet radio and reads
  the "now playing" data streams broadcast. The player needn't take that on.
  Whether they meet later (an artist's live stream playable in both, say) is
  open.
- **Podcasts as an aside, as with everything else.** A spoken series can be a
  run of `message` or `other` releases from one artist. If podcasts ever
  matter more, they'd be a feed the player reads, not something the model is
  built around.

## How listening actually happens

The pattern this is built around: pick a handful of albums you haven't
listened to yet, often bought on Bandcamp or elsewhere, put them on the
phone, listen, rotate. At any one time the phone holds a small slice of a
discography, not a mirror of it.

That makes **how the files reach the phone the least important part.** What
matters is how the phone's handful relates to the whole collection: which
release each album is, what you thought of it, what's next in the rotation.

## The shape

```
desktop collection          Nostr (public)             phone (private)
------------------          --------------             ---------------
FLAC library,       ─map─▶  release skeletons   ◀─read─ a rotating handful
ndisc / nplay               (release.v2, 31237)         of albums, mapped
                            ratings, playlists          to the same skeletons
```

- **The skeleton already exists.** ndisc publishes `release.v2` (kind 31237)
  and nview reads it. A player reads it too, and needs nothing new to share a
  release.
- **The mapping is local.** Which file on this device is which track of which
  release stays on the device, or in an event encrypted to yourself
  (NIP-44). It is never published.
- **The phone knows the collection without holding it.** It can show the
  whole discography from Nostr and mark the albums it has on board.

## Lines not to cross

The DRM question is real, and the aim is to stay as far from it as possible.
These are the guardrails, meant to hold even if everything else changes:

1. **Plays only files the user supplies.** DRM-free files: your own rips,
   Bandcamp and similar purchases. No DRM decryption, no reading other apps'
   protected libraries, no "import from Spotify".
2. **Never publishes files, links to files, or file hashes for anything the
   user doesn't hold the rights to give away.** A content hash is effectively
   a download link. For the library, skeletons carry metadata and cover art
   only. The one exception is an open release (see "Open releases"): music the
   artist has chosen to give away, published under the artist's own key.
3. **No finding other people's files.** The app can show someone else's
   skeletons (what they have, rated, curated) but never offers a way to get
   their audio, except audio its artist has published openly.
4. **No catalogue of content in the app.** No store, no bundled servers of
   music. It is a player plus a publisher, like VLC with a feed.
5. **Private storage stays private.** If a user self-hosts files anywhere
   (see "Getting files to the phone"), reads need auth and only that user's
   devices are allowed.

The practical test: if the app were misused, would the misuse come from the
app's design or despite it? The rules above are there to make the answer
"despite it". App stores pull music apps quickly when the answer is the
other one.

## Getting files to the phone (secondary)

Deliberately left open. Roughly in order of effort:

- **Copy in.** Finder or the Files app on iOS, a folder on Android. No
  infrastructure at all.
- **A designated folder the app watches.** Android: the system audio index
  (MediaStore) or a folder picked once with lasting permission. iOS: a folder
  picked in Files, kept as a bookmark. It can be on the device, in iCloud
  Drive or behind a Files provider.
- **From the desktop over the home network.** The desktop player offers the
  albums in the rotation, and the phone pulls them when it's home.
- **A self-hosted Blossom server on a VPS.** Transcoded AAC files and covers.
  Streaming and downloads both work: a Blossom fetch is a plain web request,
  and background download sessions on iOS keep going while the app sleeps.
  Only with guardrail 5: reads require a signed auth event (kind 24242) and
  only the user's own device keys are allowed.

**For testing first: nostr.build's Blossom server** (`blossom.nostr.build`,
noted 2026-09-30). It saves standing up a VPS just to find out whether the
flow works. It has a free tier (20 MiB per upload, no expiry) that takes
audio, and supports BUD-01, 02, 04, 05, 06 and 08. Uploads need a signed auth
event, which makes it a real test of signing through nsign. **But downloads
need no auth: anything uploaded there can be fetched by anyone who has its
hash.** It doesn't meet guardrail 5, so for a private library it's for
testing the plumbing only, with audio that's fine to be public: your own
releases, or openly licensed tracks. Never the purchased library. A
self-hosted server with auth on reads is still where a real library would go.
For open releases, public reads are exactly what's wanted, and it's a real
host rather than a test (see "Open releases").

**Format for anything that leaves the desktop: AAC (`.m4a`).** It's the one
format every platform plays natively (iOS, Android, macOS, Windows,
browsers), so it's the format to carry between them. The FLAC masters stay
where they are. The suite already makes **Opus** web copies (ntree plays
them next to the FLAC), and those stay for the web. But Opus is less
dependable on iOS, so a platform-independent player **needs its own AAC
pipeline**: a second transcode from the FLAC masters, not a conversion of
the Opus copies (lossy to lossy loses quality twice). Where that pipeline
lives, in ndisc beside the Opus step or in a separate tool, is open.

## Open releases

Added 2026-09-30. Everything above treats files as private. But some music is
*meant* to be given away: ad-hoc releases, demos, free EPs, live recordings,
whatever an artist chooses to put out gratis. For those, a public Blossom
server stops being a flaw and becomes the point. That's publishing, the same
as a Bandcamp "free download" or a SoundCloud upload.

- **The skeleton can carry the audio.** For an open release, the file hashes
  are part of the release, and any player can stream or download them.
  Guardrail 2's exception exists for this case.
- **Blossom suits it.** Files are addressed by content, so the same hash can
  be mirrored to other Blossom servers (BUD-04) without breaking any link. A
  release survives one host going away.
- **The artist's key does both publishing and removal.** Uploads are
  authorised by the artist's key, and so is taking a release down: the
  Blossom delete, plus a kind 5 deletion of the release event.
- **nostr.build's Blossom is a real host here, not just a test.** The limit
  that matters is 20 MiB per file on the free tier: fine for tracks, not for
  an hour-long live set (~55–60 MB even at 128 kbps AAC), which needs the paid
  tier (100 MiB) or splitting.

**The line moves; it doesn't disappear.** It stops being about whether files
are public and becomes about who holds the right to publish them:

| | |
|---|---|
| **Artist-published, gratis** | fits: signed by the artist's own key |
| **A purchased library** | stays private: buying a download isn't a right to redistribute it |
| **Someone else's music uploaded as "free"** | the misuse to design against |

Against that misuse:

- **Audio only attaches to releases signed by the artist's key**, never "any
  npub can add audio to any release".
- **The release says its terms**: a licence tag (Creative Commons or similar)
  in the event, so listeners and other apps know what they're allowed to do.
- **Takedowns stay with the host**, which nostr.build handles.

**Live audio is a good fit.** A recording of an artist's own performance
(a gig, a session, a rehearsal, an improvised set) is theirs to give away,
and is exactly the kind of thing that never gets a formal release. The
edges worth knowing:

- **Covers.** Performing someone else's song live is one thing. Distributing
  a recording of it is another: the song itself belongs to its writer, and
  in many countries putting out a recording of a cover needs a licence even
  when it's free.
- **Everyone on the recording.** Bandmates and guests have a say in a
  recording of their performance, so it's worth their agreement before it
  goes out.
- **Whose recording it is.** An artist publishing their own live audio fits.
  Someone in the audience publishing a recording they made of the artist
  doesn't, however well meant. It's the same line as before: the right to
  publish sits with the artist.
- **DJ mixes**, which are mostly other people's records, are a different
  case again: the DJ generally doesn't hold the rights to give them away.
  Mixcloud exists largely because it licenses that.

### Marking rights at the source: ndisc

If more apps connect over time, the safeguard belongs where the library is
catalogued, not in each app that touches it. ndisc is the source of truth for
the collection, so it's the natural place to mark **what the user may do with
each release**. Very loosely:

- **A per-release rights mark in ndisc**, for example *own release*,
  *purchased*, *open (licence)*. Local and private: it describes the
  collection, and the purchased side of it is nobody else's business.
- **Default-deny, like nsign's per-app policy.** No mark means private. Only
  a release explicitly marked open can have its audio uploaded publicly or
  its hashes published. A player, an uploader or any future integration asks
  ndisc and refuses otherwise.
- **The public side is one optional tag.** Only an open release would gain a
  licence field in `release.v2`. The schema already takes additive fields that
  don't bump the version (`tracks`, `discs`, `video`), but it's still a
  coordinated contract change, per SUITE.md.
- Worth noting that `release.v2` has no rights or licence field today. This
  would be new.

This keeps the rule in one place: every connected app inherits it rather than
re-deciding it, and a mistake in one app can't publish a purchased album on
its own.

## Keys and signing

- **Listening needs no identity key.** Anything the phone does to fetch or
  play files uses its own low-value device key, kept in that phone's
  keychain. Lose the phone, revoke the key. This is nsign's own split,
  identity key versus service key, applied to a player.
- **Your identity signs only what others see**: ratings (kind 7, already the
  suite's shared rating), playlists or curation, release posts. That's
  occasional, so going through nsign at home over NIP-46 is fine, and nview
  already works that way.
- **nplay on the desktop** has no key today (SUITE.md: "none for
  nplay/nping"). If it starts publishing ratings or playlists, pairing it
  with nsign fits "More clients through the signer" in nbridge's
  `docs/DIRECTION.md`. That is not the same as the stage 4 idea decided
  against in that file, moving the desktop apps' *existing* keys to the
  signer, because nplay has no key to move. Worth deciding explicitly rather than drifting into either.
- **A signer on the phone itself** (answering nostrconnect) is possible, but
  iOS won't keep a background connection open, so it becomes "open the signer
  to approve", or push via APNs with a server. That is the same question as a
  mobile nbridge ("Timely approvals on iOS" in nbridge's
  `docs/DIRECTION.md`), and should be settled together with it.

## Sharing what you play in other apps

The first version of the idea was an overlay on Apple Music, Spotify,
Bandcamp and the like, sharing what's playing to Nostr. Split up:

- **Reading another app's playback.** Android: possible, with notification
  access. iOS: largely not, apart from Apple Music through Apple's own
  framework and Spotify through its web API with a login.
- **A share extension, on both platforms: cheap and clean.** Tap Share in any
  music app → "Post to Nostr". The extension gets the link, reads title,
  artist and cover from the page, and signs through nsign. No audio is
  involved, so it stays well inside the guardrails. It could arrive before
  the player does.

## What's in reach

| | |
|---|---|
| **Now** | skeletons (`release.v2` exists) · a native iOS player with lock-screen controls, playing files copied in or from a watched folder · signing through nsign · a share extension |
| **With design work** | the private track-to-file mapping · the rotation (what's on board, what's next, what's done) · playlist and curation events, which are a SUITE.md contract change · the Android version · desktop-to-phone over the home network · Blossom with device keys (and BUD-03's user server list, kind 10063, if other people ever host their own) |
| **Hard or limited** | reading other apps' playback on iOS · a phone signer that's always available · a product for other people: onboarding, their own hosting, App Store review for a music app (TestFlight is fine for personal use) |

## A first step, if this goes anywhere

Just for one user, and with no identity signing:

1. The phone reads your `release.v2` skeletons from relays.
2. Albums copied onto the phone are matched to skeletons, by tags at first,
   and by a local mapping the desktop can export once it exists.
3. The app shows the discography, marks what's on board, and plays it.

If that feels right, the next step is rotation (what to load next, what's
been heard), then ratings through nsign, then pairing with nview. Transport
and hosting come last, because the listening pattern doesn't need them. The
one exception worth doing early is a small test on nostr.build's Blossom
server (see "Getting files to the phone"), with public-safe audio, to prove
the upload, auth and streaming path end to end.

## Open questions

- A new app, or playback added to nview? nview already reads the skeletons
  and signs through nsign. A separate player keeps nview a viewer.
- Capacitor, as nview is, or Tauri 2 mobile, which could reuse nplay's Rust
  (tag reading, the SQLite index, possibly the audio engine)? Either way,
  background playback needs native code.
- How a local album is matched to a skeleton when tags disagree with what
  ndisc published.
- Whether the rotation is private (to yourself) or something you'd publish,
  as in "listening to next".
- The shape of ndisc's rights mark: what values it takes, whether it's set
  per release or per file, and how existing releases start out (unmarked,
  which means private).
