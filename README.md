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
`synthesize_elixir`, `ft/nft_transfer*`, `storage_deposit`, `storage_unregister`) **still go through the wallet**; only the deposit-0
methods (`SIGNLESS_METHODS`, e.g. `feed_strain`, `allocate_atp`, `splice_strains`) are signless.

## `SnaccClient` — contract surface (`SDK-101..106`)

`src/client.ts` wraps every public contract method (verified by `test/parity.test.ts`
against the contract at `cabe745`; the 5 callbacks/init/migrate are explicitly
excluded there with reasons). Views + calls:

| Client method | Contract method | Deposit |
| --- | --- | --- |
| `nftMetadata()` | `nft_metadata` (NEP-177) | 0 (view) |
| `nftTotalSupply()` | `nft_total_supply` (NEP-181) | 0 (view) |
| `nftTokens(from_index?, limit?)` | `nft_tokens` | 0 (view) |
| `nftSupplyForOwner(account_id)` | `nft_supply_for_owner` | 0 (view) |
| `nftTokensForOwner(account_id, from_index?, limit?)` | `nft_tokens_for_owner` | 0 (view) |
| `storageBalanceBounds()` | `storage_balance_bounds` (NEP-145) | 0 (view) |
| `protocolVersion()` | `protocol_version` | 0 (view) |
| `getSolvencyTier(strain_id)` | `get_solvency_tier` | 0 (view) |
| `getSandboxClock()` | `get_sandbox_clock` | 0 (view) |
| `storageDeposit(account_id?, opts?)` | `storage_deposit` | min 5 milliNEAR (`registrationOnly` uses NEP-145 semantics) |
| `storageWithdraw(amount?)` | `storage_withdraw` | 0 |
| `storageUnregister(force?)` | `storage_unregister` | 1 yoctoNEAR |
| `removeAttestedSigner(pubkey_hex)` | `remove_attested_signer` | 0 |
| `advanceSandboxClock(hours)` | `advance_sandbox_clock` | 0 |

Typed views: `NftContractMetadata`, `NftTokenView`, `FungibleTokenMetadata`,
`StorageBalance`, `StorageBalanceBounds` (U128 values are decimal strings).
Event parser additions: NEP-297 `ft_mint` (`{owner_id, amount, memo?}`) alongside
`ft_transfer` / `ft_burn` (`N141-105`). Deposit methods (`storage_deposit`,
`storage_unregister`, …) are in `DEPOSIT_METHODS` and never valid on the
signless session-key path.

```bash
npm ci && npm test
SNACC_TESTNET_IT=1 npm test   # + testnet integration tests (a fresh faucet account per run)
```

The exact reference format: `repos/Snacc/contracts/snacc/src/lib.rs` (`events::emit_event_json`).
`SnaccClient` + Function Call Keys follow in `VC-016..019` / `SDK-101..106`.
