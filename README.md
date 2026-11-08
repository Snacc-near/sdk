# sdk — `M4 lab-sdk`

SDK TypeScript proyek **Snacc** untuk berinteraksi dengan kontrak `snacc-v001.near`.

Saat ini berisi parser event (`SDK-107..108`):

- `parseEventLine(line)` / `parseEventLines(lines)` — parse event kontrak `snacc-v001.near`:
  `strain_created`, `extracted`, `transmuted`, `synthesized` (JSON `{"kind":...}`) dan
  `subaccount_materialized` (log key=value).
- Mendukung bentuk polos kontrak saat ini **dan** pembungkus NEP-297 baku `EVENT_JSON:{...}`
  dengan `data: [payload]` (yang akan dipakai `VC-010`).
- JSON rusak / kind tak dikenal / field kurang → `EventParseError` dengan `reason` terkontrol.

## Function Call Access Key (`VC-016`, `src/session-key.ts`)

Sesi laboratorium *signless* (ADR-08): kunci function-call yang dibatasi ke `snacc-v001.testnet`
+ daftar method + allowance (default 0,25 NEAR), disimpan lokal, dipakai menandatangani
panggilan game tanpa popup dompet. Tanpa dependensi (WebCrypto ed25519 + borsh).

- `SessionKeyManager({ rpc, store?, contractId? })` — `createSession`, `call`, `status`
  (`active` / `allowance_low` / `exhausted` / `revoked` / `missing`), `revoke`, `forget`, `asTransport` (→ `SnaccClient`).
- `fullAccessRegistrar(rpc, secretKey)` — pendaftar `add_key`/`delete_key` dengan kunci full-access
  (tes/onboarding relayer); di browser, sediakan `KeyRegistrar` berbasis dompet.
- `MemorySessionKeyStore`, `WebStorageSessionKeyStore` (localStorage), `JsonRpcProvider` (default FastNEAR testnet).
- Error terkontrol `SessionKeyError.code`: `ALLOWANCE_EXHAUSTED`, `KEY_REVOKED`, `METHOD_NOT_ALLOWED`, `DEPOSIT_NOT_ALLOWED`, dst.

**Batas protokol NEAR:** function-call key tidak boleh membawa deposit. Method yang menuntut deposit
(`incubate_strain`, `materialize_subaccount`, `extract_spores`, `transmute_spores_to_enzyme`,
`synthesize_elixir`, `ft/nft_transfer*`, `storage_deposit`) **tetap lewat dompet**; hanya method deposit-0
(`SIGNLESS_METHODS`, mis. `feed_strain`, `allocate_atp`, `splice_strains`) yang signless.

```bash
npm ci && npm test
SNACC_TESTNET_IT=1 npm test   # + uji integrasi testnet (akun faucet baru per run)
```

Format rujukan persis: `repos/Snacc/contracts/snacc/src/lib.rs` (`events::emit_event_json`).
`SnaccClient` + Function Call Keys menyusul di `VC-016..019` / `SDK-101..106`.
