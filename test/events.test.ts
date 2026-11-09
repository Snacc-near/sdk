// SDK-107..108 — event parser unit tests (node:test).
// The fixtures are copied verbatim from the `repos/Snacc/contracts/snacc/src/lib.rs` formats.

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  EventParseError,
  parseEventLine,
  parseEventLines,
  type SnaccEvent,
} from "../src/events.js";

// The exact lib.rs formats (plain, the current shape — without the EVENT_JSON prefix).
const STRAIN_CREATED =
  '{"kind":"strain_created","strain_id":1,"owner_id":"alkemis.testnet","role_mask":1,"initial_snacc_stake":40000,"spores_minted":1}';
const EXTRACTED =
  '{"kind":"extracted","strain_id":1,"token":"mt:spore-ignis","amount":1,"catalyst_fee":100}';
const TRANSMUTED =
  '{"kind":"transmuted","strain_id":1,"burned_spores":2,"token_out":"mt:enzyme-amalgam","minted":1,"catalyst_fee":100}';
const SYNTHESIZED =
  '{"kind":"synthesized","strain_id":1,"token_out":"mt:elixir-homunculus","minted":1,"enzymes_burned":2,"catalyst_fee":100}';
// The exact lib.rs:239 format — a non-JSON log.
const SUBACCOUNT = "subaccount_materialized strain_id=1 sub_account_id=s-1.snacc-v001.near";

describe("SDK-107 — parsing the current contract's event shapes", () => {
  test("strain_created: every field is read with the right type", () => {
    const ev = parseEventLine(STRAIN_CREATED);
    assert.deepEqual(ev, {
      kind: "strain_created",
      strain_id: 1,
      owner_id: "alkemis.testnet",
      role_mask: 1,
      initial_snacc_stake: 40000,
      spores_minted: 1,
    });
    assert.equal(ev?.kind, "strain_created");
  });

  test("extracted", () => {
    assert.deepEqual(parseEventLine(EXTRACTED), {
      kind: "extracted",
      strain_id: 1,
      token: "mt:spore-ignis",
      amount: 1,
      catalyst_fee: 100,
    });
  });

  test("transmuted", () => {
    assert.deepEqual(parseEventLine(TRANSMUTED), {
      kind: "transmuted",
      strain_id: 1,
      burned_spores: 2,
      token_out: "mt:enzyme-amalgam",
      minted: 1,
      catalyst_fee: 100,
    });
  });

  test("synthesized", () => {
    assert.deepEqual(parseEventLine(SYNTHESIZED), {
      kind: "synthesized",
      strain_id: 1,
      token_out: "mt:elixir-homunculus",
      minted: 1,
      enzymes_burned: 2,
      catalyst_fee: 100,
    });
  });

  test("subaccount_materialized (a key=value log, not JSON)", () => {
    assert.deepEqual(parseEventLine(SUBACCOUNT), {
      kind: "subaccount_materialized",
      strain_id: 1,
      sub_account_id: "s-1.snacc-v001.near",
    });
  });
});

describe("SDK-107 — the standard NEP-297 wrapper (EVENT_JSON:, the VC-010 shape)", () => {
  test("EVENT_JSON:{kind:...} directly", () => {
    const ev = parseEventLine(`EVENT_JSON:${EXTRACTED}`);
    assert.equal(ev?.kind, "extracted");
  });

  test("EVENT_JSON:{standard, event, data:[payload]} → data[0] is used", () => {
    const wrapped =
      'EVENT_JSON:{"standard":"snacc","version":"1.0.0","event":"transmuted","data":[' +
      TRANSMUTED +
      "]}";
    const ev = parseEventLine(wrapped);
    assert.deepEqual(ev, {
      kind: "transmuted",
      strain_id: 1,
      burned_spores: 2,
      token_out: "mt:enzyme-amalgam",
      minted: 1,
      catalyst_fee: 100,
    });
  });

  test("NEP-141 ft_mint (with memo)", () => {
    const ev = parseEventLine(
      'EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_mint","data":[{"owner_id":"a.testnet","amount":500,"memo":"bonus"}]}',
    );
    assert.deepEqual(ev, { kind: "ft_mint", owner_id: "a.testnet", amount: 500, memo: "bonus" });
  });

  test("NEP-141 ft_mint (memo absent)", () => {
    const ev = parseEventLine(
      'EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_mint","data":[{"owner_id":"a.testnet","amount":500}]}',
    );
    assert.deepEqual(ev, { kind: "ft_mint", owner_id: "a.testnet", amount: 500 });
  });

  test("NEP-141 ft_mint missing a required field → MISSING_FIELDS", () => {
    assert.throws(
      () => parseEventLine('EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_mint","data":[{"amount":500}]}'),
      (err: unknown) => err instanceof EventParseError && err.reason === "MISSING_FIELDS",
    );
  });
});

describe("SDK-108 — controlled errors & non-event lines", () => {
  test("broken JSON after EVENT_JSON: → EventParseError INVALID_JSON", () => {
    assert.throws(
      () => parseEventLine('EVENT_JSON:{"kind":"extracted",'),
      (err: unknown) => err instanceof EventParseError && err.reason === "INVALID_JSON",
    );
  });

  test("valid JSON but not an event (an array) → NOT_AN_EVENT_OBJECT", () => {
    assert.throws(
      () => parseEventLine("EVENT_JSON:[1,2,3]"),
      (err: unknown) => err instanceof EventParseError && err.reason === "NOT_AN_EVENT_OBJECT",
    );
  });

  test("an unknown kind → UNKNOWN_KIND", () => {
    assert.throws(
      () => parseEventLine('{"kind":"halo_dunia"}'),
      (err: unknown) => err instanceof EventParseError && err.reason === "UNKNOWN_KIND",
    );
  });

  test("a missing required field → MISSING_FIELDS", () => {
    assert.throws(
      () => parseEventLine('{"kind":"extracted","strain_id":1}'),
      (err: unknown) => err instanceof EventParseError && err.reason === "MISSING_FIELDS",
    );
  });

  test("a log without the required fields → MISSING_FIELDS", () => {
    assert.throws(
      () => parseEventLine("subaccount_materialized strain_id=1"),
      (err: unknown) => err instanceof EventParseError && err.reason === "MISSING_FIELDS",
    );
  });

  test("empty lines & ordinary logs → null", () => {
    assert.equal(parseEventLine(""), null);
    assert.equal(parseEventLine("   "), null);
    assert.equal(parseEventLine("INFO contract started"), null);
  });

  test("subaccount_materialized with a non-numeric strain_id → INVALID_JSON", () => {
    assert.throws(
      () => parseEventLine("subaccount_materialized strain_id=abc sub_account_id=s-1.snacc-v001.near"),
      (err: unknown) => err instanceof EventParseError && err.reason === "INVALID_JSON",
    );
  });

  test("parseEventLines skips non-event lines and preserves the order", () => {
    const events = parseEventLines([
      "INFO contract started",
      STRAIN_CREATED,
      "",
      SUBACCOUNT,
      EXTRACTED,
      TRANSMUTED,
      SYNTHESIZED,
    ]);
    assert.equal(events.length, 5);
    const kinds = events.map((e: SnaccEvent) => e.kind);
    assert.deepEqual(kinds, [
      "strain_created",
      "subaccount_materialized",
      "extracted",
      "transmuted",
      "synthesized",
    ]);
  });
});
