// SDK-107..108 — unit test parser event (node:test).
// Fixture disalin persis dari format `repos/Snacc/contracts/snacc/src/lib.rs`.

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  EventParseError,
  parseEventLine,
  parseEventLines,
  type SnaccEvent,
} from "../src/events.js";

// Format persis lib.rs (polos, bentuk saat ini — tanpa prefix EVENT_JSON).
const STRAIN_CREATED =
  '{"kind":"strain_created","strain_id":1,"owner_id":"alkemis.testnet","role_mask":1,"initial_snacc_stake":40000,"spores_minted":1}';
const EXTRACTED =
  '{"kind":"extracted","strain_id":1,"token":"mt:spore-ignis","amount":1,"catalyst_fee":100}';
const TRANSMUTED =
  '{"kind":"transmuted","strain_id":1,"burned_spores":2,"token_out":"mt:enzyme-amalgam","minted":1,"catalyst_fee":100}';
const SYNTHESIZED =
  '{"kind":"synthesized","strain_id":1,"token_out":"mt:elixir-homunculus","minted":1,"enzymes_burned":2,"catalyst_fee":100}';
// Format persis lib.rs:239 — log non-JSON.
const SUBACCOUNT = "subaccount_materialized strain_id=1 sub_account_id=s-1.snacc-v001.near";

describe("SDK-107 — parse event bentuk kontrak saat ini", () => {
  test("strain_created: semua field terbaca bertipe benar", () => {
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

  test("subaccount_materialized (log key=value, bukan JSON)", () => {
    assert.deepEqual(parseEventLine(SUBACCOUNT), {
      kind: "subaccount_materialized",
      strain_id: 1,
      sub_account_id: "s-1.snacc-v001.near",
    });
  });
});

describe("SDK-107 — pembungkus NEP-297 baku (EVENT_JSON:, bentuk VC-010)", () => {
  test("EVENT_JSON:{kind:...} langsung", () => {
    const ev = parseEventLine(`EVENT_JSON:${EXTRACTED}`);
    assert.equal(ev?.kind, "extracted");
  });

  test("EVENT_JSON:{standard, event, data:[payload]} → data[0] dipakai", () => {
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
});

describe("SDK-108 — error terkontrol & baris non-event", () => {
  test("JSON rusak setelah EVENT_JSON: → EventParseError INVALID_JSON", () => {
    assert.throws(
      () => parseEventLine('EVENT_JSON:{"kind":"extracted",'),
      (err: unknown) => err instanceof EventParseError && err.reason === "INVALID_JSON",
    );
  });

  test("JSON valid tapi bukan event (array) → NOT_AN_EVENT_OBJECT", () => {
    assert.throws(
      () => parseEventLine("EVENT_JSON:[1,2,3]"),
      (err: unknown) => err instanceof EventParseError && err.reason === "NOT_AN_EVENT_OBJECT",
    );
  });

  test("kind tidak dikenal → UNKNOWN_KIND", () => {
    assert.throws(
      () => parseEventLine('{"kind":"halo_dunia"}'),
      (err: unknown) => err instanceof EventParseError && err.reason === "UNKNOWN_KIND",
    );
  });

  test("field wajib kurang → MISSING_FIELDS", () => {
    assert.throws(
      () => parseEventLine('{"kind":"extracted","strain_id":1}'),
      (err: unknown) => err instanceof EventParseError && err.reason === "MISSING_FIELDS",
    );
  });

  test("log tanpa field wajib → MISSING_FIELDS", () => {
    assert.throws(
      () => parseEventLine("subaccount_materialized strain_id=1"),
      (err: unknown) => err instanceof EventParseError && err.reason === "MISSING_FIELDS",
    );
  });

  test("baris kosong & log biasa → null", () => {
    assert.equal(parseEventLine(""), null);
    assert.equal(parseEventLine("   "), null);
    assert.equal(parseEventLine("INFO contract started"), null);
  });

  test("subaccount_materialized dengan strain_id bukan angka → INVALID_JSON", () => {
    assert.throws(
      () => parseEventLine("subaccount_materialized strain_id=abc sub_account_id=s-1.snacc-v001.near"),
      (err: unknown) => err instanceof EventParseError && err.reason === "INVALID_JSON",
    );
  });

  test("parseEventLines melewati baris non-event dan menjaga urutan", () => {
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
