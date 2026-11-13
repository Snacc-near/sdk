// SDK-101..106 — `SnaccClient`: wrappers for ALL public methods of the `snacc-v001`
// contract (exact signatures from `contracts/snacc/src/lib.rs`) + view wrappers.
//
// Design:
// - The transport is injected (`Transport`) so unit tests use a mock with no network.
// - u128 values are sent as **strings** (the NEAR JSON convention; safe above 2^53).
// - The right automatic deposit per method (from lib.rs):
//     · incubate_strain           → deposit = initial_snacc_stake (attached == stake)
//     · materialize_subaccount    → deposit = 0.02 NEAR = 2×10^22 yocto (20 milliNEAR)
//     · extract/synthesize        → deposit = snacc_catalyst_fee (attached == fee)
//     · transmute                 → deposit = the fee, optionally with the EN-110 diet discount (×0.8)
//     · nft_transfer/ft_transfer  → 1 yoctoNEAR (the standard)
//     · the rest (feed, claim, M&A, NPC, etc.) → 0 (feed/claim payable-refund in the contract)
import { parseEventLine, type SnaccEvent } from "./events.js";

export const ONE_YOCTO = "1";
export const MATERIALIZE_DEPOSIT_YOCTO = "20000000000000000000000"; // 20 milliNEAR
/** First-registration storage minimum (5 milliNEAR, `storage_deposit` / `storage_balance_bounds`). */
export const STORAGE_DEPOSIT_MIN_YOCTO = "5000000000000000000000";

// ─── Contract view types (exact shapes from `contracts/snacc/src/lib.rs`) ───

/** `NEP-177` contract-level metadata (`nft_metadata`). */
export interface NftContractMetadata {
  spec: string;
  name: string;
  symbol: string;
  icon: string | null;
  base_uri: string | null;
  reference: string | null;
  reference_hash: string | null;
}

/** `NEP-141` metadata (`ft_metadata`, decimals are 24 by recorded decision). */
export interface FungibleTokenMetadata {
  spec: string;
  name: string;
  symbol: string;
  decimals: number;
  icon: string | null;
  reference: string | null;
  reference_hash: string | null;
}

/** `NEP-171` token view (`nft_token` and the `nft_tokens*` enumerations). */
export interface NftTokenView {
  token_id: string;
  owner_id: string;
  metadata: {
    title: string;
    description: string;
    media: string;
  };
}

/** MVP storage balance (`storage_deposit` / `storage_withdraw` / `storage_balance_of`). */
export interface StorageBalance {
  total: string;
  available: string;
}

/** `NEP-145` storage balance bounds (`storage_balance_bounds`); `max` is unbounded. */
export interface StorageBalanceBounds {
  min: string;
  max: string | null;
}

/** A minimal JSON-RPC transport — real implementations live in the wallet/backend; a mock in tests. */
export interface Transport {
  /** `query` → `call_function`: return the already-parsed view result. */
  view<T>(method: string, args: Record<string, unknown>): Promise<T>;
  /** Send a transaction (the signer is held by the implementation); return the tx result. */
  call(
    method: string,
    args: Record<string, unknown>,
    attachedDepositYocto: string,
  ): Promise<TxResult>;
}

export interface TxResult {
  txHash: string;
  /** The emitted NEP-297 events (already parsed from the receipt logs). */
  events: SnaccEvent[];
  success: boolean;
  /** Raw receipt logs (optional — from the transport). */
  logs?: string[];
}

export interface SnaccClientOptions {
  contractId: string;
  transport: Transport;
}

type U128 = string | number | bigint;

const u = (v: U128): string => v.toString();

/** Collect the events from a tx result; non-event lines are ignored (the `gladi-kpi` pattern). */
export function eventsFromTxResult(result: {
  logs?: string[];
}): SnaccEvent[] {
  const out: SnaccEvent[] = [];
  for (const line of result.logs ?? []) {
    const ev = parseEventLine(line);
    if (ev) out.push(ev);
  }
  return out;
}

export class SnaccClient {
  readonly contractId: string;
  private readonly transport: Transport;

  constructor(opts: SnaccClientOptions) {
    this.contractId = opts.contractId;
    this.transport = opts.transport;
  }

  private async call(
    method: string,
    args: Record<string, unknown>,
    attachedDepositYocto: string = "0",
  ): Promise<TxResult> {
    const res = await this.transport.call(method, args, attachedDepositYocto);
    // The transport that supplies `events` is used; when absent, parse from `logs`.
    const events = res.events?.length ? res.events : eventsFromTxResult(res);
    return { ...res, events };
  }

  // ─── Views (J3.8/J3.9 + everything else) ───

  getStrain(strain_id: U128) {
    return this.transport.view<Record<string, unknown>>("get_strain", { strain_id: u(strain_id) });
  }
  getInventory(strain_id: U128, token_id: string) {
    return this.transport.view<string>("get_inventory", { strain_id: u(strain_id), token_id });
  }
  getColony(owner_id: string) {
    return this.transport.view<Record<string, unknown>[]>("get_colony", { owner_id });
  }
  getColonyAtp(owner_id: string) {
    return this.transport.view<string>("get_colony_atp", { owner_id });
  }
  getRiskHeat() {
    return this.transport.view<number>("get_risk_heat", {});
  }
  getAppetiteMeter() {
    return this.transport.view<Record<string, unknown>>("get_appetite_meter", {});
  }
  getMacroState() {
    return this.transport.view<Record<string, unknown>>("get_macro_state", {});
  }
  getGlobalSolvency() {
    return this.transport.view<Record<string, unknown>>("get_global_solvency", {});
  }
  getCrucibleTemp() {
    return this.transport.view<number>("get_crucible_temp", {});
  }
  getDividendPool() {
    return this.transport.view<[string, string, number]>("get_dividend_pool", {});
  }
  getEpochDividendRate(epoch: U128) {
    return this.transport.view<string>("get_epoch_dividend_rate", { epoch: u(epoch) });
  }
  getDividendContribution(epoch: U128, strain_id: U128) {
    return this.transport.view<[string, boolean]>("get_dividend_contribution", {
      epoch: u(epoch),
      strain_id: u(strain_id),
    });
  }
  getTopFeeder(epoch: U128) {
    return this.transport.view<Record<string, unknown>[]>("get_top_feeder", { epoch: u(epoch) });
  }
  getBurstState() {
    return this.transport.view<[string, number]>("get_burst_state", {});
  }
  getNpc(npc_id: string) {
    return this.transport.view<Record<string, unknown>>("get_npc", { npc_id });
  }
  getNpcQuote(npc_id: string, buy_amount: number) {
    return this.transport.view<Record<string, unknown>>("npc_quote_spores", { npc_id, buy_amount });
  }
  getTotalWealth(account_id: string) {
    return this.transport.view<string>("get_total_wealth", { account_id });
  }
  getStorageBalance(account_id: string) {
    return this.transport.view<Record<string, unknown> | null>("storage_balance_of", { account_id });
  }
  ftBalanceOf(account_id: string) {
    return this.transport.view<string>("ft_balance_of", { account_id });
  }
  ftTotalSupply() {
    return this.transport.view<string>("ft_total_supply", {});
  }
  ftMetadata() {
    return this.transport.view<FungibleTokenMetadata>("ft_metadata", {});
  }
  nftToken(token_id: string) {
    return this.transport.view<NftTokenView>("nft_token", { token_id });
  }

  // ─── NEP-171/177/145 views (PR #21 surface) ───

  /** `NEP-177` contract-level metadata. */
  nftMetadata() {
    return this.transport.view<NftContractMetadata>("nft_metadata", {});
  }
  /** `NEP-181` total minted NFTs. */
  nftTotalSupply() {
    return this.transport.view<string>("nft_total_supply", {});
  }
  /** `NEP-181` paginated enumeration; `from_index`/`limit` are optional (`null` = default). */
  nftTokens(from_index?: U128 | null, limit?: number | null) {
    return this.transport.view<NftTokenView[]>("nft_tokens", {
      from_index: from_index == null ? null : u(from_index),
      limit: limit ?? null,
    });
  }
  /** `NEP-181` per-owner supply. */
  nftSupplyForOwner(account_id: string) {
    return this.transport.view<string>("nft_supply_for_owner", { account_id });
  }
  /** `NEP-181` per-owner enumeration with pagination. */
  nftTokensForOwner(account_id: string, from_index?: U128 | null, limit?: number | null) {
    return this.transport.view<NftTokenView[]>("nft_tokens_for_owner", {
      account_id,
      from_index: from_index == null ? null : u(from_index),
      limit: limit ?? null,
    });
  }
  /** `NEP-145` storage balance bounds (minimum for first registration; `max` unbounded). */
  storageBalanceBounds() {
    return this.transport.view<StorageBalanceBounds>("storage_balance_bounds", {});
  }
  /** Contract protocol version string (`snacc-v001`). */
  protocolVersion() {
    return this.transport.view<string>("protocol_version", {});
  }
  /** Solvency tier of a strain (`Tier1Healthy` / `Tier2Chapter11Distressed` / `Tier3Chapter7Insolvent`). */
  getSolvencyTier(strain_id: U128) {
    return this.transport.view<string>("get_solvency_tier", { strain_id: u(strain_id) });
  }
  /** Sandbox clock view: `[enabled, sandbox_time_offset_sec, now_sec]`. */
  getSandboxClock() {
    return this.transport.view<[boolean, number, number]>("get_sandbox_clock", {});
  }

  // ─── F1: birth & sub-account ───

  /** Automatic deposit: attached == initial_snacc_stake. */
  incubateStrain(role: string, initialSnaccStake: U128, initialSpores: number) {
    return this.call(
      "incubate_strain",
      { role, initial_snacc_stake: u(initialSnaccStake), initial_spores: initialSpores },
      u(initialSnaccStake),
    );
  }
  /** Automatic deposit: ≥ 20 milliNEAR (0.02 NEAR). */
  materializeSubaccount(strain_id: U128) {
    return this.call("materialize_subaccount", { strain_id: u(strain_id) }, MATERIALIZE_DEPOSIT_YOCTO);
  }

  // ─── F2: the supply chain (deposit == fee; transmute may use the ×0.8 diet discount) ───

  extractSpores(strain_id: U128, spore_type: string, catalystFee: U128) {
    return this.call(
      "extract_spores",
      { strain_id: u(strain_id), spore_type, snacc_catalyst_fee: u(catalystFee) },
      u(catalystFee),
    );
  }
  /** `diet` = zona/kasta memberi diskon 20% (EN-110) → attached = fee × 0,8. */
  transmuteSporesToEnzyme(
    strain_id: U128,
    spores_to_burn: number,
    catalystFee: U128,
    opts: { diet?: boolean } = {},
  ) {
    const deposit = opts.diet ? (BigInt(u(catalystFee)) * 8n / 10n).toString() : u(catalystFee);
    return this.call(
      "transmute_spores_to_enzyme",
      { strain_id: u(strain_id), spores_to_burn, snacc_catalyst_fee: u(catalystFee) },
      deposit,
    );
  }
  synthesizeElixir(strain_id: U128, elixir_type: string, enzymes_to_burn: number, catalystFee: U128) {
    return this.call(
      "synthesize_elixir",
      { strain_id: u(strain_id), elixir_type, enzymes_to_burn, snacc_catalyst_fee: u(catalystFee) },
      u(catalystFee),
    );
  }

  // ─── F3: TEE ───

  commitGenomeExperiment(strain_id: U128, req_sha256_hex: string) {
    return this.call("commit_genome_experiment", { strain_id: u(strain_id), req_sha256_hex });
  }
  applyTeeMutationZeroTrust(
    strain_id: U128,
    req_sha256_hex: string,
    raw_response_body: string,
    signature_hex: string,
    tee_pubkey_hex: string,
  ) {
    return this.call("apply_tee_mutation_zero_trust", {
      strain_id: u(strain_id),
      req_sha256_hex,
      raw_response_body,
      signature_hex,
      tee_pubkey_hex,
    });
  }

  // ─── ATP ───

  allocateAtp(strain_id: U128, mitokondria: number, nukleus: number, lisosom: number) {
    return this.call("allocate_atp", {
      strain_id: u(strain_id),
      mitokondria,
      nukleus,
      lisosom,
    });
  }
  feedStrain(strain_id: U128, amount: U128) {
    return this.call("feed_strain", { strain_id: u(strain_id), amount: u(amount) });
  }

  // ─── M&A, reproduction, colony ───

  spliceStrains(dominant_id: U128, absorbed_id: U128) {
    return this.call("splice_strains", {
      dominant_id: u(dominant_id),
      absorbed_id: u(absorbed_id),
    });
  }
  hostileTakeoverSplice(raider_strain_id: U128, distressed_target_id: U128, expected_target_nonce: U128) {
    return this.call("hostile_takeover_splice", {
      raider_strain_id: u(raider_strain_id),
      distressed_target_id: u(distressed_target_id),
      expected_target_nonce: u(expected_target_nonce),
    });
  }
  adopt(target_id: U128, raider_strain_id: U128, expected_target_nonce: U128) {
    return this.call("adopt", {
      target_id: u(target_id),
      raider_strain_id: u(raider_strain_id),
      expected_target_nonce: u(expected_target_nonce),
    });
  }
  divideStrain(strain_id: U128) {
    return this.call("divide_strain", { strain_id: u(strain_id) });
  }
  harvestStarvingStrain(target_id: U128) {
    return this.call("harvest_starving_strain", { target_id: u(target_id) });
  }
  conjugateTraits(from_strain_id: U128, to_strain_id: U128, phenotype_trait: string) {
    return this.call("conjugate_traits", {
      from_strain_id: u(from_strain_id),
      to_strain_id: u(to_strain_id),
      phenotype_trait,
    });
  }

  // ─── NPC ADR-30 ───

  npcBuySpores(strain_id: U128, npc_id: string, buy_amount: number) {
    return this.call("npc_buy_spores", {
      strain_id: u(strain_id),
      npc_id,
      buy_amount,
    });
  }

  // ─── Dividends DK-033/044 ───

  synthesizeAndRedeemAether(strain_id: U128, amount: U128) {
    return this.call("synthesize_and_redeem_aether", {
      strain_id: u(strain_id),
      amount: u(amount),
    });
  }
  claimIndustrialDividend(strain_id: U128, epoch: U128) {
    return this.call("claim_industrial_dividend", {
      strain_id: u(strain_id),
      epoch: u(epoch),
    });
  }
  advanceEpoch() {
    return this.call("advance_epoch", {});
  }
  registerAttestedSigner(pubkey_hex: string, attested_at_sec: U128) {
    return this.call("register_attested_signer", { pubkey_hex, attested_at_sec: u(attested_at_sec) });
  }

  // ─── Standard transfers (1 yoctoNEAR) ───

  // NEP-171: `approval_id` is `Option<u64>`, so it goes over JSON as a number (or null), not as a string.
  nftTransfer(receiver_id: string, token_id: string, approval_id?: number | null, memo?: string | null) {
    return this.call(
      "nft_transfer",
      { receiver_id, token_id, approval_id: approval_id ?? null, memo: memo ?? null },
      ONE_YOCTO,
    );
  }
  nftTransferCall(receiver_id: string, token_id: string, msg: string, approval_id?: number | null, memo?: string | null) {
    return this.call(
      "nft_transfer_call",
      { receiver_id, token_id, msg, approval_id: approval_id ?? null, memo: memo ?? null },
      ONE_YOCTO,
    );
  }
  ftTransfer(receiver_id: string, amount: U128, memo?: string | null) {
    return this.call(
      "ft_transfer",
      { receiver_id, amount: u(amount), memo: memo ?? null },
      ONE_YOCTO,
    );
  }
  ftTransferCall(receiver_id: string, amount: U128, msg: string, memo?: string | null) {
    return this.call(
      "ft_transfer_call",
      { receiver_id, amount: u(amount), msg, memo: memo ?? null },
      ONE_YOCTO,
    );
  }
  ftBurn(strain_id: U128, amount: U128) {
    return this.call("ft_burn", { strain_id: u(strain_id), amount: u(amount) });
  }

  // ─── Attested signers (TEE trust list) ───

  removeAttestedSigner(pubkey_hex: string) {
    return this.call("remove_attested_signer", { pubkey_hex });
  }

  /** Advance the sandbox clock (contract owner only on chain; deposit 0). */
  advanceSandboxClock(hours: number) {
    return this.call("advance_sandbox_clock", { hours });
  }

  // ─── Storage (NEP-145) ───
  // All storage calls below are payable on chain and carry a deposit, so they must
  // NOT go through the session (function-call) key path — see `DEPOSIT_METHODS`.

  /**
   * Register/top up a storage deposit for `account_id` (defaults to the caller).
   * Deposit defaults to the first-registration minimum (5 milliNEAR); pass
   * `depositYocto` for top-ups. `registrationOnly` uses NEP-145 semantics
   * (register with exactly the minimum and refund any excess).
   */
  storageDeposit(account_id?: string, opts: { registrationOnly?: boolean; depositYocto?: string } = {}) {
    return this.call(
      "storage_deposit",
      {
        account_id: account_id ?? null,
        registration_only: opts.registrationOnly ?? null,
      },
      opts.depositYocto ?? STORAGE_DEPOSIT_MIN_YOCTO,
    );
  }
  /**
   * Withdraw the excess storage deposit. `#[payable]` on chain but valid with a
   * 0 deposit (the minimum stays locked while the account holds $SNACC).
   */
  storageWithdraw(amount?: U128 | null) {
    return this.call("storage_withdraw", { amount: amount == null ? null : u(amount) });
  }
  /** Remove the caller's storage registration; `assert_one_yocto` → 1 yoctoNEAR. `force` unregisters even with a balance. */
  storageUnregister(force?: boolean | null) {
    return this.call("storage_unregister", { force: force ?? null }, ONE_YOCTO);
  }
}
