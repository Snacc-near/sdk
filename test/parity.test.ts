// SDK-101..106 — ABI parity test: every public method of the `snacc` contract
// must be wrapped by `SnaccClient` or explicitly listed as excluded with a reason.
//
// Method list source: `contracts/snacc/src/lib.rs` at contract commit `cabe745`
// (all 66 `pub fn`, including the `#[private]` callbacks and init/migrate).
// If the contract gains a method, add it here first (wrapped or excluded).

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { DEPOSIT_METHODS, SIGNLESS_METHODS } from "../src/session-key.js";
import { SnaccClient, type Transport } from "../src/client.js";

/** All 66 public methods of the contract at `cabe745` (verbatim names). */
const CONTRACT_METHODS: readonly string[] = [
  "advance_sandbox_clock",
  "get_sandbox_clock",
  "new",
  "protocol_version",
  "incubate_strain",
  "materialize_subaccount",
  "on_subaccount_created",
  "get_strain",
  "get_solvency_tier",
  "get_crucible_temp",
  "get_macro_state",
  "advance_epoch",
  "ft_burn",
  "extract_spores",
  "transmute_spores_to_enzyme",
  "synthesize_elixir",
  "commit_genome_experiment",
  "apply_tee_mutation_zero_trust",
  "register_attested_signer",
  "remove_attested_signer",
  "splice_strains",
  "hostile_takeover_splice",
  "harvest_starving_strain",
  "nft_token",
  "nft_metadata",
  "nft_total_supply",
  "nft_tokens",
  "nft_supply_for_owner",
  "nft_tokens_for_owner",
  "ft_balance_of",
  "ft_total_supply",
  "get_total_wealth",
  "ft_transfer",
  "ft_transfer_call",
  "on_transfer_call",
  "ft_metadata",
  "storage_deposit",
  "storage_withdraw",
  "storage_balance_of",
  "storage_balance_bounds",
  "storage_unregister",
  "synthesize_and_redeem_aether",
  "claim_industrial_dividend",
  "get_dividend_pool",
  "get_epoch_dividend_rate",
  "get_dividend_contribution",
  "get_burst_state",
  "feed_strain",
  "get_top_feeder",
  "get_appetite_meter",
  "migrate",
  "get_colony",
  "get_colony_atp",
  "divide_strain",
  "adopt",
  "conjugate_traits",
  "get_risk_heat",
  "get_npc",
  "npc_quote_spores",
  "npc_buy_spores",
  "allocate_atp",
  "nft_transfer",
  "nft_transfer_call",
  "nft_resolve_transfer",
  "get_inventory",
  "get_global_solvency",
];

/** Contract method → `SnaccClient` method name. */
const WRAPPED: Record<string, string> = {
  advance_sandbox_clock: "advanceSandboxClock",
  get_sandbox_clock: "getSandboxClock",
  protocol_version: "protocolVersion",
  incubate_strain: "incubateStrain",
  materialize_subaccount: "materializeSubaccount",
  get_strain: "getStrain",
  get_solvency_tier: "getSolvencyTier",
  get_crucible_temp: "getCrucibleTemp",
  get_macro_state: "getMacroState",
  advance_epoch: "advanceEpoch",
  ft_burn: "ftBurn",
  extract_spores: "extractSpores",
  transmute_spores_to_enzyme: "transmuteSporesToEnzyme",
  synthesize_elixir: "synthesizeElixir",
  commit_genome_experiment: "commitGenomeExperiment",
  apply_tee_mutation_zero_trust: "applyTeeMutationZeroTrust",
  register_attested_signer: "registerAttestedSigner",
  remove_attested_signer: "removeAttestedSigner",
  splice_strains: "spliceStrains",
  hostile_takeover_splice: "hostileTakeoverSplice",
  harvest_starving_strain: "harvestStarvingStrain",
  nft_token: "nftToken",
  nft_metadata: "nftMetadata",
  nft_total_supply: "nftTotalSupply",
  nft_tokens: "nftTokens",
  nft_supply_for_owner: "nftSupplyForOwner",
  nft_tokens_for_owner: "nftTokensForOwner",
  ft_balance_of: "ftBalanceOf",
  ft_total_supply: "ftTotalSupply",
  get_total_wealth: "getTotalWealth",
  ft_transfer: "ftTransfer",
  ft_transfer_call: "ftTransferCall",
  ft_metadata: "ftMetadata",
  storage_deposit: "storageDeposit",
  storage_withdraw: "storageWithdraw",
  storage_balance_of: "getStorageBalance",
  storage_balance_bounds: "storageBalanceBounds",
  storage_unregister: "storageUnregister",
  synthesize_and_redeem_aether: "synthesizeAndRedeemAether",
  claim_industrial_dividend: "claimIndustrialDividend",
  get_dividend_pool: "getDividendPool",
  get_epoch_dividend_rate: "getEpochDividendRate",
  get_dividend_contribution: "getDividendContribution",
  get_burst_state: "getBurstState",
  feed_strain: "feedStrain",
  get_top_feeder: "getTopFeeder",
  get_appetite_meter: "getAppetiteMeter",
  get_colony: "getColony",
  get_colony_atp: "getColonyAtp",
  divide_strain: "divideStrain",
  adopt: "adopt",
  conjugate_traits: "conjugateTraits",
  get_risk_heat: "getRiskHeat",
  get_npc: "getNpc",
  npc_quote_spores: "getNpcQuote",
  npc_buy_spores: "npcBuySpores",
  allocate_atp: "allocateAtp",
  nft_transfer: "nftTransfer",
  nft_transfer_call: "nftTransferCall",
  get_inventory: "getInventory",
  get_global_solvency: "getGlobalSolvency",
};

/** Intentionally excluded from `SnaccClient`, with the reason. */
const EXCLUDED: Record<string, string> = {
  new: "init constructor, not callable after deploy",
  migrate: "#[private] migration, contract account only",
  on_subaccount_created: "#[private] cross-contract callback",
  on_transfer_call: "#[private] ft_transfer_call callback",
  nft_resolve_transfer: "#[private] nft_transfer_call callback",
};

function mockTransport(): Transport {
  return {
    async view(method) {
      throw new Error(`no view fixture for ${method}`);
    },
    async call() {
      return { txHash: "MOCK", events: [], success: true };
    },
  };
}

describe("SDK-101 — ABI parity with the contract (cabe745)", () => {
  test("every contract method is wrapped or explicitly excluded", () => {
    const client = new SnaccClient({ contractId: "snacc-v001.testnet", transport: mockTransport() });
    const missing: string[] = [];
    for (const method of CONTRACT_METHODS) {
      const wrapper = WRAPPED[method];
      if (wrapper !== undefined) {
        const fn = (client as unknown as Record<string, unknown>)[wrapper];
        assert.equal(typeof fn, "function", `${method} should be wrapped by ${wrapper}`);
      } else if (EXCLUDED[method] === undefined) {
        missing.push(method);
      }
    }
    assert.deepEqual(missing, [], "contract methods without a wrapper or exclusion");
  });

  test("no stale entries: every WRAPPED/EXCLUDED key is a real contract method", () => {
    for (const key of [...Object.keys(WRAPPED), ...Object.keys(EXCLUDED)]) {
      assert.ok(CONTRACT_METHODS.includes(key), `${key} is not a contract method`);
    }
  });

  test("no method is both wrapped and excluded", () => {
    for (const key of Object.keys(WRAPPED)) {
      assert.equal(EXCLUDED[key], undefined, `${key} is both wrapped and excluded`);
    }
  });

  test("deposit methods never overlap with the signless (session key) path", () => {
    for (const m of DEPOSIT_METHODS) {
      assert.ok(!SIGNLESS_METHODS.includes(m), `${m} is both a deposit method and signless`);
    }
  });

  test("every excluded entry carries a reason", () => {
    for (const [key, reason] of Object.entries(EXCLUDED)) {
      assert.ok(reason.length > 0, `${key} has an empty exclusion reason`);
    }
  });
});
