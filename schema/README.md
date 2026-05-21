# ndisc event schema — canonical contract

ndisc publishes its discography to Nostr; the glmps web viewers
(`glmps.fizx.uk` / `glmps.upleb.uk`) consume it. This directory is the
**single canonical home** of the wire contract between them.

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
