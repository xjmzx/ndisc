# ndisc event schema — canonical contract

ndisc publishes its discography to Nostr; the glmps web viewers
(`glmps.fizx.uk` / `glmps.upleb.uk`) consume it. This directory is the
**single canonical home** of the wire contract between them.

## How it fits together

```
  ndisc — release_event() in src-tauri/src/lib.rs
     │   (the ONLY code that emits events)
     │ described by
     ▼
  schema/release.v1.json            ← CANONICAL · FROZEN
     │
     ├─ pinned in ndisc by ──►  mod schema_v1  (cargo test)
     │                          ndisc's build fails if emitted output drifts
     │
     └─ vendored verbatim by ─►  glmps, both sites
                                 assert-parse + freeze check on every build;
                                 glmps's build fails if its copy ≠ canonical
                                 or its parser violates v1
     │
     ▼
  any change to the emitted format  →  release.v2.json
                                       (never edit v1 in place)
```

In words: **ndisc's code is the only thing that emits events.**
`release.v1.json` *describes* that output and is the canonical, frozen
contract. ndisc's own build is pinned to it by a `cargo test`; glmps vendors
a verbatim copy and its build checks both that the copy matches canonical and
that its parser honours v1. Two repos, one wire format — and because both ends
fail their build the moment they drift, a schema change *cannot* ship
silently: it forces a coordinated `release.v2.json`.

## Files

- `release.v1.json` — the frozen v1 contract for the kind:31237 release
  event and the kind:5 (NIP-09) deletion event.
- `fixtures/` — reference events conforming to v1:
  - `release-31237.full.json` — every optional tag populated.
  - `release-31237.minimal.json` — every optional field absent (note: no
    `medium` tag — consumers must not require it).
  - `deletion-5.json` — a NIP-09 deletion.

## Source of truth & the contract test

ndisc's code — `src-tauri/src/lib.rs`, `release_event()` — is what actually
emits the events. `release.v1.json` *describes* it, and the contract test
(`mod schema_v1` in the same file) *pins* ndisc's output to it:

```
cargo test --manifest-path src-tauri/Cargo.toml schema_v1
```

If that test fails, ndisc's emitted format has drifted from the contract.

## Change policy

`release.v1.json` is **frozen**. Any change to the emitted event format is a
**coordinated v2 bump**:

1. Add `release.v2.json` (do not edit v1).
2. Update the contract test to assert v2.
3. Update the glmps viewers to read v2.

Consumers vendor a copy of `release.v1.json`; this repo's copy is canonical
and wins on any discrepancy.
