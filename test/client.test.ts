// SDK-101..106 — `SnaccClient` unit tests + a parser for 23 kinds (node:test, mock transport).

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  eventsFromTxResult,
  MATERIALIZE_DEPOSIT_YOCTO,
  ONE_YOCTO,
  SnaccClient,
  type Transport,
  type TxResult,
} from "../src/client.js";
import { parseEventLine } from "../src/events.js";

/** A mock transport: records every call; replies to views with fixtures. */
function mockTransport(views: Record<string, unknown> = {}) {
  const calls: { kind: "view" | "call"; method: string; args: Record<string, unknown>; deposit: string }[] = [];
  const txResults: TxResult[] = [];
  const transport: Transport = {
    async view(method, args) {
      calls.push({ kind: "view", method, args, deposit: "0" });
      const v = views[method];
      if (v === undefined) throw new Error(`view not available in the mock: ${method}`);
      return v as never;
    },
    async call(method, args, deposit) {
      calls.push({ kind: "call", method, args, deposit });
      const res = txResults.shift() ?? { txHash: "MOCK", events: [], success: true, logs: [] };
      return res;
    },
  };
  return { transport, calls, txResults };
}

describe("SDK-101 — parser: the remaining 19 canonical kinds + standard events", () => {
  const cases: [string, string, string][] = [
    ["fed", '{"kind":"fed","strain_id":1,"base_fee":1000,"effective_fee":828,"burst_bps":2000,"rescue_bps":9200,"dormant":false,"atp_minted":5}', "atp_minted"],
    ["atp_spent", '{"kind":"atp_spent","strain_id":1,"purpose":"splice","cost":5}', "cost"],
    ["atp_allocated", '{"kind":"atp_allocated","strain_id":1,"mitokondria":2,"nukleus":1,"lisosom":0,"cost":3,"epoch":0}', "epoch"],
    ["genome_committed", '{"kind":"genome_committed","strain_id":1,"req_sha256_hex":"ab"}', "req_sha256_hex"],
    ["genome_mutated", '{"kind":"genome_mutated","strain_id":1,"efficiency_shift_bps":450,"vitality_bonus":200}', "vitality_bonus"],
    ["strains_spliced", '{"kind":"strains_spliced","dominant_id":1,"absorbed_id":2,"merger_tax":200}', "merger_tax"],
    ["hostile_takeover_spliced", '{"kind":"hostile_takeover_spliced","raider_id":2,"target_id":1,"book_value":800,"payment":920,"seller_payout":874,"treasury_cut":46}', "treasury_cut"],
    ["strain_liquidated", '{"kind":"strain_liquidated","target_id":1,"liquidator":"h.testnet","bounty":80,"treasury_recovery":720}', "treasury_recovery"],
    ["strain_divided", '{"kind":"strain_divided","parent_id":1,"child_id":3,"child_generation":2,"parent_balance":400,"child_balance":400,"child_vitality":4250,"child_spores":2}', "child_spores"],
    ["strain_adopted", '{"kind":"strain_adopted","target_id":1,"adopter":"r.testnet","raider_strain_id":2,"book_value":800}', "book_value"],
    ["trait_conjugated", '{"kind":"trait_conjugated","from_strain_id":1,"to_strain_id":2,"phenotype_trait":"T"}', "phenotype_trait"],
    ["feast_result", '{"kind":"feast_result","epoch":0,"volume":900,"target":1000,"verdict":"GOLDILOCKS"}', "verdict"],
    ["zone_changed", '{"kind":"zone_changed","from_zone":"NORMAL","to_zone":"HYPO","crucible_temp":500}', "crucible_temp"],
    ["nutrient_burst_released", '{"kind":"nutrient_burst_released","strain_id":1,"epoch":0,"released_vita":7200,"burst_bps":2000,"until_epoch":1}', "until_epoch"],
    ["npc_spores_bought", '{"kind":"npc_spores_bought","strain_id":1,"npc_id":"npc-vulture-ma","amount":1,"unit_price":100,"total_cost":100}', "total_cost"],
    ["dividend_inflow", '{"kind":"dividend_inflow","action":"catalyst_fee","fee":100,"burned":0,"inflow":50,"epoch":0}', "inflow"],
    ["aether_burned_for_dividend", '{"kind":"aether_burned_for_dividend","strain_id":5,"amount":1,"epoch":0,"cumulative":1}', "cumulative"],
    ["epoch_dividend_closed", '{"kind":"epoch_dividend_closed","epoch":0,"pool":50,"total_burned":1,"rate":50000000000000000000}', "rate"],
    ["dividend_claimed", '{"kind":"dividend_claimed","strain_id":5,"epoch":0,"contribution":1,"payout":50,"pool_after":0}', "pool_after"],
  ];
  for (const [kind, line, field] of cases) {
    test(`kind ${kind} parses (the ${field} field exists)`, () => {
      const ev = parseEventLine(line);
      assert.ok(ev, `${kind} must parse`);
      assert.equal(ev.kind, kind);
      assert.ok((ev as unknown as Record<string, unknown>)[field] !== undefined);
    });
  }

  test("NEP-297 standard events: nep141 ft_transfer & nep171 nft_transfer", () => {
    const ft = parseEventLine(
      'EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{"old_owner_id":"a.testnet","new_owner_id":"b.testnet","amount":500,"memo":null}]}',
    );
    assert.ok(ft);
    assert.equal(ft.kind, "ft_transfer");
    const nft = parseEventLine(
      'EVENT_JSON:{"standard":"nep171","version":"1.0.0","event":"nft_transfer","data":[{"old_owner_id":"a.testnet","new_owner_id":"b.testnet","token_ids":["1"],"approved_account_ids":null,"memo":null}]}',
    );
    assert.ok(nft);
    assert.equal(nft.kind, "nft_transfer");
  });

  test("an unknown kind is still rejected (UNKNOWN_KIND)", () => {
    assert.throws(() => parseEventLine('{"kind":"halo"}'), /unknown kind/);
  });
});

describe("SDK-102..103 — SnaccClient: view wrappers", () => {
  test("get_strain/get_inventory/get_colony/get_colony_atp forward the right arguments", async () => {
    const { transport, calls } = mockTransport({
      get_strain: { strain_id: 1 },
      get_inventory: "3",
      get_colony: [],
      get_colony_atp: "100",
    });
    const client = new SnaccClient({ contractId: "snacc-v001.testnet", transport });
    await client.getStrain(1);
    await client.getInventory(1, "mt:spore-ignis");
    await client.getColony("alkemis.testnet");
    await client.getColonyAtp("alkemis.testnet");
    assert.deepEqual(calls.map((c) => c.method), [
      "get_strain",
      "get_inventory",
      "get_colony",
      "get_colony_atp",
    ]);
    assert.deepEqual(calls[0]?.args, { strain_id: "1" });
    assert.deepEqual(calls[1]?.args, { strain_id: "1", token_id: "mt:spore-ignis" });
    assert.deepEqual(calls[2]?.args, { owner_id: "alkemis.testnet" });
  });

  test("macro/dividend/NPC/FT/NFT views exist and return the fixtures", async () => {
    const fixture = { crucible_temp: 610, macro: { current_epoch: 1 }, solvency: { solvent: true } };
    const { transport, calls } = mockTransport({
      get_crucible_temp: fixture.crucible_temp,
      get_macro_state: fixture.macro,
      get_global_solvency: fixture.solvency,
      get_risk_heat: 5000,
      get_appetite_meter: { zone: "HYPO" },
      get_dividend_pool: ["50", "0", 1],
      get_npc: { npc_id: "npc-vulture-ma" },
      ft_balance_of: "800",
      ft_total_supply: "1000000",
      ft_metadata: { symbol: "$SNACC" },
      nft_token: { token_id: "1" },
      get_top_feeder: [],
      get_burst_state: ["0", 0],
      get_total_wealth: "800",
    });
    const client = new SnaccClient({ contractId: "snacc-v001.testnet", transport });
    assert.equal(await client.getCrucibleTemp(), 610);
    assert.equal((await client.getMacroState()).current_epoch, 1);
    assert.equal((await client.getGlobalSolvency()).solvent, true);
    assert.equal(await client.getRiskHeat(), 5000);
    assert.deepEqual(await client.getAppetiteMeter(), { zone: "HYPO" });
    assert.deepEqual(await client.getDividendPool(), ["50", "0", 1]);
    assert.equal((await client.getNpc("npc-vulture-ma")).npc_id, "npc-vulture-ma");
    assert.equal(await client.ftBalanceOf("a.testnet"), "800");
    assert.equal(await client.ftTotalSupply(), "1000000");
    assert.equal((await client.ftMetadata()).symbol, "$SNACC");
    assert.equal((await client.nftToken("1")).token_id, "1");
    assert.equal(await client.getTotalWealth("a.testnet"), "800");
    assert.equal(calls.length, 12, "12 views recorded");
  });

  test("NEP-171/177/145 views pass the exact contract arguments", async () => {
    const { transport, calls } = mockTransport({
      nft_metadata: { spec: "nft-1.0.0", name: "Snacc", symbol: "$SNACC", icon: null, base_uri: null, reference: null, reference_hash: null },
      nft_total_supply: "3",
      nft_tokens: [],
      nft_supply_for_owner: "2",
      nft_tokens_for_owner: [],
      storage_balance_bounds: { min: "5000000000000000000000", max: null },
      protocol_version: "snacc-v001",
      get_solvency_tier: "Tier1Healthy",
      get_sandbox_clock: [false, 0, 123],
    });
    const client = new SnaccClient({ contractId: "snacc-v001.testnet", transport });
    assert.equal((await client.nftMetadata()).spec, "nft-1.0.0");
    assert.equal(await client.nftTotalSupply(), "3");
    assert.deepEqual(await client.nftTokens(), []);
    assert.equal(await client.nftSupplyForOwner("a.testnet"), "2");
    assert.deepEqual(await client.nftTokensForOwner("a.testnet", 0, 10), []);
    assert.equal((await client.storageBalanceBounds()).min, "5000000000000000000000");
    assert.equal(await client.protocolVersion(), "snacc-v001");
    assert.equal(await client.getSolvencyTier(1), "Tier1Healthy");
    assert.deepEqual(await client.getSandboxClock(), [false, 0, 123]);
    assert.deepEqual(
      calls.map((c) => c.method),
      [
        "nft_metadata",
        "nft_total_supply",
        "nft_tokens",
        "nft_supply_for_owner",
        "nft_tokens_for_owner",
        "storage_balance_bounds",
        "protocol_version",
        "get_solvency_tier",
        "get_sandbox_clock",
      ],
    );
    assert.deepEqual(calls[2]?.args, { from_index: null, limit: null });
    assert.deepEqual(calls[4]?.args, { account_id: "a.testnet", from_index: "0", limit: 10 });
    assert.deepEqual(calls[7]?.args, { strain_id: "1" });
  });

  test("storage calls carry the right deposit (deposit == min / 1 yocto / 0)", async () => {
    const { transport, calls } = mockTransport();
    const client = new SnaccClient({ contractId: "c.testnet", transport });
    await client.storageDeposit();
    await client.storageDeposit("b.testnet", { registrationOnly: true, depositYocto: "9000000000000000000000" });
    await client.storageWithdraw();
    await client.storageUnregister();
    await client.storageUnregister(true);
    assert.deepEqual(calls[0]?.args, { account_id: null, registration_only: null });
    assert.equal(calls[0]?.deposit, "5000000000000000000000");
    assert.deepEqual(calls[1]?.args, { account_id: "b.testnet", registration_only: true });
    assert.equal(calls[1]?.deposit, "9000000000000000000000");
    assert.deepEqual(calls[2]?.args, { amount: null });
    assert.equal(calls[2]?.deposit, "0");
    assert.deepEqual(calls[3]?.args, { force: null });
    assert.equal(calls[3]?.deposit, ONE_YOCTO);
    assert.deepEqual(calls[4]?.args, { force: true });
    assert.equal(calls[4]?.deposit, ONE_YOCTO);
  });

  test("attested-signer and sandbox calls use deposit 0", async () => {
    const { transport, calls } = mockTransport();
    const client = new SnaccClient({ contractId: "c.testnet", transport });
    await client.removeAttestedSigner("aa");
    await client.advanceSandboxClock(2);
    assert.equal(calls[0]?.method, "remove_attested_signer");
    assert.deepEqual(calls[0]?.args, { pubkey_hex: "aa" });
    assert.equal(calls[0]?.deposit, "0");
    assert.equal(calls[1]?.method, "advance_sandbox_clock");
    assert.deepEqual(calls[1]?.args, { hours: 2 });
    assert.equal(calls[1]?.deposit, "0");
  });
});

describe("SDK-104 — the right automatic deposit", () => {
  test("incubate_strain: deposit == initial_snacc_stake", async () => {
    const { transport, calls } = mockTransport();
    const client = new SnaccClient({ contractId: "c.testnet", transport });
    await client.incubateStrain("Extractor", "1000000", 3);
    assert.equal(calls[0]?.method, "incubate_strain");
    assert.equal(calls[0]?.deposit, "1000000");
    assert.deepEqual(calls[0]?.args, {
      role: "Extractor",
      initial_snacc_stake: "1000000",
      initial_spores: 3,
    });
  });

  test("materialize_subaccount: deposit == 20 milliNEAR", async () => {
    const { transport, calls } = mockTransport();
    const client = new SnaccClient({ contractId: "c.testnet", transport });
    await client.materializeSubaccount(1);
    assert.equal(calls[0]?.deposit, MATERIALIZE_DEPOSIT_YOCTO);
    assert.equal(BigInt(MATERIALIZE_DEPOSIT_YOCTO), 20n * 10n ** 21n, "20 milliNEAR");
  });

  test("extract/synthesize: deposit == fee; transmute without a diet == fee", async () => {
    const { transport, calls } = mockTransport();
    const client = new SnaccClient({ contractId: "c.testnet", transport });
    await client.extractSpores(1, "mt:spore-ignis", 1000);
    await client.synthesizeElixir(1, "mt:elixir-aether", 3, 2000);
    await client.transmuteSporesToEnzyme(1, 2, 1000);
    assert.equal(calls[0]?.deposit, "1000");
    assert.equal(calls[1]?.deposit, "2000");
    assert.equal(calls[2]?.deposit, "1000");
  });

  test("transmute with the EN-110 diet: deposit == fee × 0.8", async () => {
    const { transport, calls } = mockTransport();
    const client = new SnaccClient({ contractId: "c.testnet", transport });
    await client.transmuteSporesToEnzyme(1, 2, 1000, { diet: true });
    assert.equal(calls[0]?.deposit, "800");
    // The nominal amount stays intact in the args (the contract recomputes it).
    assert.deepEqual(calls[0]?.args, {
      strain_id: "1",
      spores_to_burn: 2,
      snacc_catalyst_fee: "1000",
    });
  });

  test("standard transfers: deposit == 1 yoctoNEAR", async () => {
    const { transport, calls } = mockTransport();
    const client = new SnaccClient({ contractId: "c.testnet", transport });
    await client.ftTransfer("b.testnet", 500, "memo");
    await client.ftTransferCall("b.testnet", 500, "msg");
    await client.nftTransfer("b.testnet", "1", null, null);
    await client.nftTransferCall("b.testnet", "1", "msg");
    for (const c of calls) {
      assert.equal(c.deposit, ONE_YOCTO, `${c.method} requires 1 yocto`);
    }
    assert.deepEqual(calls[0]?.args, { receiver_id: "b.testnet", amount: "500", memo: "memo" });
  });

  test("EN-126: nft_transfer / nft_transfer_call send approval_id as a JSON number (NEP-171 Option<u64>), or null", async () => {
    const { transport, calls } = mockTransport();
    const client = new SnaccClient({ contractId: "c.testnet", transport });
    await client.nftTransfer("b.testnet", "1", 7, "gift");
    await client.nftTransferCall("b.testnet", "1", "msg", 42, null);
    await client.nftTransfer("b.testnet", "1");
    await client.nftTransferCall("b.testnet", "1", "msg", null);

    assert.deepEqual(calls[0]?.args, { receiver_id: "b.testnet", token_id: "1", approval_id: 7, memo: "gift" });
    assert.deepEqual(calls[1]?.args, { receiver_id: "b.testnet", token_id: "1", msg: "msg", approval_id: 42, memo: null });
    assert.equal(typeof calls[0]?.args.approval_id, "number");
    assert.equal(typeof calls[1]?.args.approval_id, "number");
    // What goes over the wire: `"approval_id":7`, not `"approval_id":"7"`.
    assert.match(JSON.stringify(calls[0]?.args), /"approval_id":7[,}]/);
    assert.match(JSON.stringify(calls[1]?.args), /"approval_id":42[,}]/);
    // Omitted or null stays JSON null.
    assert.equal(calls[2]?.args.approval_id, null);
    assert.equal(calls[3]?.args.approval_id, null);

    // The type no longer accepts a string.
    // @ts-expect-error approval_id is number | null, not a string
    await client.nftTransfer("b.testnet", "1", "7");
    // @ts-expect-error approval_id is number | null, not a string
    await client.nftTransferCall("b.testnet", "1", "msg", "7");
  });

  test("zero-cost methods: feed/claim/M&A/NPC/advance/TEE/burn/register = deposit 0", async () => {
    const { transport, calls } = mockTransport();
    const client = new SnaccClient({ contractId: "c.testnet", transport });
    await client.feedStrain(1, 500);
    await client.claimIndustrialDividend(1, 0);
    await client.spliceStrains(1, 2);
    await client.hostileTakeoverSplice(2, 1, 0);
    await client.adopt(1, 2, 0);
    await client.divideStrain(1);
    await client.harvestStarvingStrain(1);
    await client.conjugateTraits(1, 2, "T");
    await client.npcBuySpores(1, "npc-vulture-ma", 1);
    await client.synthesizeAndRedeemAether(1, 1);
    await client.advanceEpoch();
    await client.registerAttestedSigner("aa", 0);
    await client.allocateAtp(1, 1, 0, 0);
    await client.commitGenomeExperiment(1, "ab");
    await client.applyTeeMutationZeroTrust(1, "ab", "body", "sig", "pk");
    await client.ftBurn(1, 100);
    for (const c of calls) {
      assert.equal(c.deposit, "0", `${c.method} deposit 0`);
    }
    assert.equal(calls.length, 16);
    // The hostile/adopt/TEE signatures match lib.rs exactly.
    assert.deepEqual(calls[3]?.args, {
      raider_strain_id: "2",
      distressed_target_id: "1",
      expected_target_nonce: "0",
    });
    assert.deepEqual(calls[4]?.args, {
      target_id: "1",
      raider_strain_id: "2",
      expected_target_nonce: "0",
    });
  });
});

describe("SDK-105 — events from the tx result", () => {
  test("eventsFromTxResult parses the NEP-297 logs and ignores other logs", () => {
    const res = {
      logs: [
        'EVENT_JSON:{"standard":"snacc","version":"1.0.0","event":"fed","data":[{"kind":"fed","strain_id":1,"base_fee":1000,"effective_fee":900,"burst_bps":0,"rescue_bps":10000,"dormant":false,"atp_minted":2}]}',
        "an ordinary log, not an event",
        'EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_burn","data":[{"owner_id":"a.testnet","amount":100}]}',
      ],
    };
    const evs = eventsFromTxResult(res);
    assert.equal(evs.length, 2);
    assert.equal(evs[0]?.kind, "fed");
    assert.equal(evs[1]?.kind, "ft_burn");
  });

  test("client.call attaches the events from the transport's TxResult", async () => {
    const { transport, txResults } = mockTransport();
    txResults.push({
      txHash: "H",
      success: true,
      events: [],
      logs: [
        'EVENT_JSON:{"standard":"snacc","version":"1.0.0","event":"strain_created","data":[{"kind":"strain_created","strain_id":1,"owner_id":"a.testnet","role_mask":1,"initial_snacc_stake":10,"spores_minted":1}]}',
      ],
    });
    const client = new SnaccClient({ contractId: "c.testnet", transport });
    const res = await client.incubateStrain("Extractor", 10, 1);
    assert.equal(res.txHash, "H");
    assert.equal(res.events[0]?.kind, "strain_created");
  });
});

describe("SDK-106 — the contract ID & u128-as-string", () => {
  test("large u128 values are sent as strings (safe above 2^53)", async () => {
    const { transport, calls } = mockTransport();
    const client = new SnaccClient({ contractId: "c.testnet", transport });
    const big = "340282366920938463463374607431768211455"; // u128::MAX
    await client.ftTransfer("b.testnet", big);
    await client.feedStrain(1, big);
    assert.equal(calls[0]?.args.amount, big);
    assert.equal(calls[1]?.args.amount, big);
    assert.equal(typeof calls[0]?.args.amount, "string");
  });

  test("the contractId is stored and used by consumers (documented behavior)", () => {
    const { transport } = mockTransport();
    const client = new SnaccClient({ contractId: "snacc-v001.testnet", transport });
    assert.equal(client.contractId, "snacc-v001.testnet");
  });
});
