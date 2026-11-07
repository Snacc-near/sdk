# sdk — `M4 lab-sdk`

SDK TypeScript proyek **Snacc** untuk berinteraksi dengan kontrak `snacc-v001.near`.

Saat ini berisi parser event (`SDK-107..108`):

- `parseEventLine(line)` / `parseEventLines(lines)` — parse event kontrak `snacc-v001.near`:
  `strain_created`, `extracted`, `transmuted`, `synthesized` (JSON `{"kind":...}`) dan
  `subaccount_materialized` (log key=value).
- Mendukung bentuk polos kontrak saat ini **dan** pembungkus NEP-297 baku `EVENT_JSON:{...}`
  dengan `data: [payload]` (yang akan dipakai `VC-010`).
- JSON rusak / kind tak dikenal / field kurang → `EventParseError` dengan `reason` terkontrol.

```bash
npm ci && npm test
```

Format rujukan persis: `repos/Snacc/contracts/snacc/src/lib.rs` (`events::emit_event_json`).
`SnaccClient` + Function Call Keys menyusul di `VC-016..019` / `SDK-101..106`.
