# sdk — `M4 lab-sdk`

The **Snacc** TypeScript SDK for interacting with the `snacc-v001.near` contract.

Currently contains the event parser (`SDK-107..108`):

- `parseEventLine(line)` / `parseEventLines(lines)` — parses `snacc-v001.near` contract events:
  `strain_created`, `extracted`, `transmuted`, `synthesized` (JSON `{"kind":...}`) and
  `subaccount_materialized` (a key=value log).
- Supports both the plain shape of the current contract **and** the standard NEP-297 wrapper
  `EVENT_JSON:{...}` with `data: [payload]` (to be used by `VC-010`).
- Broken JSON / an unknown kind / a missing field → an `EventParseError` with a controlled `reason`.

## Function Call Access Key (`VC-016`, `src/session-key.ts`)

A *signless* lab session (ADR-08): a function-call key restricted to `snacc-v001.testnet`
+ a method allowlist + an allowance (default 0.25 NEAR), stored locally, used to sign
game calls without wallet popups. Dependency-free (WebCrypto ed25519 + borsh).

- `SessionKeyManager({ rpc, store?, contractId? })` — `createSession`, `call`, `status`
  (`active` / `allowance_low` / `exhausted` / `revoked` / `missing`), `revoke`, `forget`, `asTransport` (→ `SnaccClient`).
- `fullAccessRegistrar(rpc, secretKey)` — an `add_key`/`delete_key` registrar using a full-access key
  (tests/relayer onboarding); in a browser, provide a wallet-based `KeyRegistrar`.
- `MemorySessionKeyStore`, `WebStorageSessionKeyStore` (localStorage), `JsonRpcProvider` (FastNEAR testnet by default).
- Controlled errors via `SessionKeyError.code`: `ALLOWANCE_EXHAUSTED`, `KEY_REVOKED`, `METHOD_NOT_ALLOWED`, `DEPOSIT_NOT_ALLOWED`, etc.

**NEAR protocol constraint:** a function-call key cannot carry a deposit. Methods that require a deposit
(`incubate_strain`, `materialize_subaccount`, `extract_spores`, `transmute_spores_to_enzyme`,
`synthesize_elixir`, `ft/nft_transfer*`, `storage_deposit`) **still go through the wallet**; only the deposit-0
methods (`SIGNLESS_METHODS`, e.g. `feed_strain`, `allocate_atp`, `splice_strains`) are signless.

```bash
npm ci && npm test
SNACC_TESTNET_IT=1 npm test   # + testnet integration tests (a fresh faucet account per run)
```

The exact reference format: `repos/Snacc/contracts/snacc/src/lib.rs` (`events::emit_event_json`).
`SnaccClient` + Function Call Keys follow in `VC-016..019` / `SDK-101..106`.
