// SDK-107..108 — the `snacc-v001.near` contract event parser for `lab-sdk` (M4).
//
// The EXACT reference format comes from `repos/Snacc/contracts/snacc/src/lib.rs` (the
// `events::emit_event_json` call) and `lib.rs:239` (the sub-account log). The four JSON events
// ALREADY emitted by the contract (the current shape: one JSON line with a `kind` field):
//
//   {"kind":"strain_created","strain_id":N,"owner_id":"...","role_mask":N,"initial_snacc_stake":N,"spores_minted":N}
//   {"kind":"extracted","strain_id":N,"token":"...","amount":1,"catalyst_fee":N}
//   {"kind":"transmuted","strain_id":N,"burned_spores":N,"token_out":"...","minted":N,"catalyst_fee":N}
//   {"kind":"synthesized","strain_id":N,"token_out":"...","minted":N,"enzymes_burned":N,"catalyst_fee":N}
//
// Ditambah log non-JSON (lib.rs:239):
//   subaccount_materialized strain_id=N sub_account_id=s-<id>.snacc-v001.near
//
// The parser also accepts the standard NEP-297 wrapper `EVENT_JSON:{...}` (VC-010 will use
// this shape): an object with `data: [payload]` and `event` (or `kind`) at the top level.
//
// AMBIGUITY (recorded, not resolved):
// A1. `emit_event_json` in the contract is still a `TODO(VC-010)` stub — the `EVENT_JSON:` prefix is not
//     actually installed yet; the parser supports both shapes (plain & prefixed) so it does not
//     need to change when VC-010 merges.
// A2. u128 values (`initial_snacc_stake`, `catalyst_fee`) are parsed as JSON `number`s;
//     values above 2^53 lose precision — BigInt handling will be standardized later
//     together with `SnaccClient` (VC-016..019).

/** A controlled error for logs that look like events but cannot be parsed. */
export class EventParseError extends Error {
  constructor(
    public readonly reason:
      | "INVALID_JSON"
      | "NOT_AN_EVENT_OBJECT"
      | "UNKNOWN_KIND"
      | "MISSING_FIELDS",
    message: string,
  ) {
    super(message);
    this.name = "EventParseError";
  }
}

export interface StrainCreatedEvent {
  kind: "strain_created";
  strain_id: number;
  owner_id: string;
  role_mask: number;
  initial_snacc_stake: number;
  spores_minted: number;
}

export interface ExtractedEvent {
  kind: "extracted";
  strain_id: number;
  token: string;
  amount: number;
  catalyst_fee: number;
}

export interface TransmutedEvent {
  kind: "transmuted";
  strain_id: number;
  burned_spores: number;
  token_out: string;
  minted: number;
  catalyst_fee: number;
}

export interface SynthesizedEvent {
  kind: "synthesized";
  strain_id: number;
  token_out: string;
  minted: number;
  enzymes_burned: number;
  catalyst_fee: number;
}

export interface SubaccountMaterializedEvent {
  kind: "subaccount_materialized";
  strain_id: number;
  sub_account_id: string;
}

// ─── SDK-101..106 — the remaining 19 canonical kinds (grep `lib.rs`, copy verbatim) ───

export interface FedEvent {
  kind: "fed";
  strain_id: number;
  base_fee: number;
  effective_fee: number;
  burst_bps: number;
  rescue_bps: number;
  dormant: boolean;
  atp_minted: number;
}

export interface AtpSpentEvent {
  kind: "atp_spent";
  strain_id: number;
  purpose: string;
  cost: number;
}

export interface AtpAllocatedEvent {
  kind: "atp_allocated";
  strain_id: number;
  mitokondria: number;
  nukleus: number;
  lisosom: number;
  cost: number;
  epoch: number;
}

export interface GenomeCommittedEvent {
  kind: "genome_committed";
  strain_id: number;
  req_sha256_hex: string;
}

export interface GenomeMutatedEvent {
  kind: "genome_mutated";
  strain_id: number;
  efficiency_shift_bps: number;
  vitality_bonus: number;
}

export interface StrainsSplicedEvent {
  kind: "strains_spliced";
  dominant_id: number;
  absorbed_id: number;
  merger_tax: number;
}

export interface HostileTakeoverSplicedEvent {
  kind: "hostile_takeover_spliced";
  raider_id: number;
  target_id: number;
  book_value: number;
  payment: number;
  seller_payout: number;
  treasury_cut: number;
}

export interface StrainLiquidatedEvent {
  kind: "strain_liquidated";
  target_id: number;
  liquidator: string;
  bounty: number;
  treasury_recovery: number;
}

export interface StrainDividedEvent {
  kind: "strain_divided";
  parent_id: number;
  child_id: number;
  child_generation: number;
  parent_balance: number;
  child_balance: number;
  child_vitality: number;
  child_spores: number;
}

export interface StrainAdoptedEvent {
  kind: "strain_adopted";
  target_id: number;
  adopter: string;
  raider_strain_id: number;
  book_value: number;
}

export interface TraitConjugatedEvent {
  kind: "trait_conjugated";
  from_strain_id: number;
  to_strain_id: number;
  phenotype_trait: string;
}

export interface FeastResultEvent {
  kind: "feast_result";
  epoch: number;
  volume: number;
  target: number;
  verdict: string;
}

export interface ZoneChangedEvent {
  kind: "zone_changed";
  from_zone: string;
  to_zone: string;
  crucible_temp: number;
}

export interface NutrientBurstReleasedEvent {
  kind: "nutrient_burst_released";
  strain_id: number;
  epoch: number;
  released_vita: number;
  burst_bps: number;
  until_epoch: number;
}

export interface NpcSporesBoughtEvent {
  kind: "npc_spores_bought";
  strain_id: number;
  npc_id: string;
  amount: number;
  unit_price: number;
  total_cost: number;
}

export interface DividendInflowEvent {
  kind: "dividend_inflow";
  action: string;
  fee: number;
  burned: number;
  inflow: number;
  epoch: number;
}

export interface AetherBurnedForDividendEvent {
  kind: "aether_burned_for_dividend";
  strain_id: number;
  amount: number;
  epoch: number;
  cumulative: number;
}

export interface EpochDividendClosedEvent {
  kind: "epoch_dividend_closed";
  epoch: number;
  pool: number;
  total_burned: number;
  rate: number;
}

export interface DividendClaimedEvent {
  kind: "dividend_claimed";
  strain_id: number;
  epoch: number;
  contribution: number;
  payout: number;
  pool_after: number;
}

// ─── Standard events (the name sits directly in the envelope, without a `kind` in the payload) ───

export interface Nep141TransferEvent {
  kind: "ft_transfer";
  old_owner_id: string;
  new_owner_id: string;
  // NEP-141 events standard: a decimal string (u128). The parser accepts both
  // a JSON number (the currently deployed contract) and a string (after
  // redeploy) and always normalizes to a decimal string; a string input is
  // never routed through a lossy JS number.
  amount: string;
  memo: string | null;
}

export interface Nep141BurnEvent {
  kind: "ft_burn";
  owner_id: string;
  // Same decimal-string rule as `ft_transfer` (`amount` above).
  amount: string;
  memo: string | null;
}

export interface Nep141MintEvent {
  kind: "ft_mint";
  owner_id: string;
  // Same decimal-string rule as `ft_transfer` (`amount` above).
  amount: string;
  memo?: string | null;
}

export interface Nep171TransferEvent {
  kind: "nft_transfer";
  old_owner_id: string;
  new_owner_id: string;
  token_ids: string[];
  approved_account_ids: null;
  memo: string | null;
}

export type SnaccEvent =
  | StrainCreatedEvent
  | ExtractedEvent
  | TransmutedEvent
  | SynthesizedEvent
  | SubaccountMaterializedEvent
  | FedEvent
  | AtpSpentEvent
  | AtpAllocatedEvent
  | GenomeCommittedEvent
  | GenomeMutatedEvent
  | StrainsSplicedEvent
  | HostileTakeoverSplicedEvent
  | StrainLiquidatedEvent
  | StrainDividedEvent
  | StrainAdoptedEvent
  | TraitConjugatedEvent
  | FeastResultEvent
  | ZoneChangedEvent
  | NutrientBurstReleasedEvent
  | NpcSporesBoughtEvent
  | DividendInflowEvent
  | AetherBurnedForDividendEvent
  | EpochDividendClosedEvent
  | DividendClaimedEvent
  | Nep141TransferEvent
  | Nep141BurnEvent
  | Nep141MintEvent
  | Nep171TransferEvent;

const KNOWN_KINDS = new Set([
  "strain_created",
  "extracted",
  "transmuted",
  "synthesized",
  "subaccount_materialized",
  "fed",
  "atp_spent",
  "atp_allocated",
  "genome_committed",
  "genome_mutated",
  "strains_spliced",
  "hostile_takeover_spliced",
  "strain_liquidated",
  "strain_divided",
  "strain_adopted",
  "trait_conjugated",
  "feast_result",
  "zone_changed",
  "nutrient_burst_released",
  "npc_spores_bought",
  "dividend_inflow",
  "aether_burned_for_dividend",
  "epoch_dividend_closed",
  "dividend_claimed",
  "ft_transfer",
  "ft_burn",
  "ft_mint",
  "nft_transfer",
]);

/** Required fields per kind — copied verbatim from the `lib.rs` formats. */
const REQUIRED_FIELDS: Record<string, string[]> = {
  strain_created: ["strain_id", "owner_id", "role_mask", "initial_snacc_stake", "spores_minted"],
  extracted: ["strain_id", "token", "amount", "catalyst_fee"],
  transmuted: ["strain_id", "burned_spores", "token_out", "minted", "catalyst_fee"],
  synthesized: ["strain_id", "token_out", "minted", "enzymes_burned", "catalyst_fee"],
  subaccount_materialized: ["strain_id", "sub_account_id"],
  fed: ["strain_id", "base_fee", "effective_fee", "burst_bps", "rescue_bps", "dormant", "atp_minted"],
  atp_spent: ["strain_id", "purpose", "cost"],
  atp_allocated: ["strain_id", "mitokondria", "nukleus", "lisosom", "cost", "epoch"],
  genome_committed: ["strain_id", "req_sha256_hex"],
  genome_mutated: ["strain_id", "efficiency_shift_bps", "vitality_bonus"],
  strains_spliced: ["dominant_id", "absorbed_id", "merger_tax"],
  hostile_takeover_spliced: ["raider_id", "target_id", "book_value", "payment", "seller_payout", "treasury_cut"],
  strain_liquidated: ["target_id", "liquidator", "bounty", "treasury_recovery"],
  strain_divided: ["parent_id", "child_id", "child_generation", "parent_balance", "child_balance", "child_vitality", "child_spores"],
  strain_adopted: ["target_id", "adopter", "raider_strain_id", "book_value"],
  trait_conjugated: ["from_strain_id", "to_strain_id", "phenotype_trait"],
  feast_result: ["epoch", "volume", "target", "verdict"],
  zone_changed: ["from_zone", "to_zone", "crucible_temp"],
  nutrient_burst_released: ["strain_id", "epoch", "released_vita", "burst_bps", "until_epoch"],
  npc_spores_bought: ["strain_id", "npc_id", "amount", "unit_price", "total_cost"],
  dividend_inflow: ["action", "fee", "burned", "inflow", "epoch"],
  aether_burned_for_dividend: ["strain_id", "amount", "epoch", "cumulative"],
  epoch_dividend_closed: ["epoch", "pool", "total_burned", "rate"],
  dividend_claimed: ["strain_id", "epoch", "contribution", "payout", "pool_after"],
  ft_transfer: ["old_owner_id", "new_owner_id", "amount", "memo"],
  ft_burn: ["owner_id", "amount"],
  ft_mint: ["owner_id", "amount"],
  nft_transfer: ["old_owner_id", "new_owner_id", "token_ids", "approved_account_ids", "memo"],
};

/** Unwrap the standard NEP-297 wrapper (`EVENT_JSON:` + `data: [...]`) when present. */
function unwrap(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith("EVENT_JSON:")
    ? trimmed.slice("EVENT_JSON:".length)
    : trimmed;

  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch (err) {
    throw new EventParseError(
      "INVALID_JSON",
      `not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new EventParseError("NOT_AN_EVENT_OBJECT", "the event must be a JSON object");
  }

  const record = obj as Record<string, unknown>;
  // Bentuk NEP-297 baku: { standard, version, event, data: [payload] }.
  if (Array.isArray(record.data)) {
    const payload = record.data[0];
    if (typeof payload !== "object" || payload === null) {
      throw new EventParseError("NOT_AN_EVENT_OBJECT", "data[0] must be an object");
    }
    const inner = payload as Record<string, unknown>;
    if (typeof record.event === "string" && inner.kind === undefined) {
      return { ...inner, kind: record.event };
    }
    return inner as Record<string, unknown>;
  }
  return record;
}

/** NEP-141 kinds whose `amount` is a u128 decimal (emitted as a string). */
const NEP141_KINDS = new Set(["ft_transfer", "ft_burn", "ft_mint"]);

/**
 * Normalize a NEP-141 `amount` to a decimal string.
 * - String input: validated as a bare decimal integer and returned verbatim —
 *   never routed through `Number()`, which loses precision above 2^53.
 * - Number input (the currently deployed contract): an exact, safe-integer
 *   JS number becomes its decimal string. A number that JSON.parse already
 *   rounded (above 2^53) cannot be recovered; the value is then whatever the
 *   number holds — another reason to prefer the string form.
 */
function normalizeNep141Amount(value: unknown): string {
  if (typeof value === "string") {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
      throw new EventParseError(
        "INVALID_JSON",
        `NEP-141 amount must be a decimal string, got: ${value}`,
      );
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new EventParseError(
        "INVALID_JSON",
        `NEP-141 amount number must be a non-negative safe integer, got: ${value}`,
      );
    }
    return String(value);
  }
  throw new EventParseError("INVALID_JSON", "NEP-141 amount must be a string or a number");
}

/** Validate the required fields per kind, then return the typed event. */
function buildEvent(kind: string, fields: Record<string, unknown>): SnaccEvent {
  const required = REQUIRED_FIELDS[kind];
  if (required === undefined) {
    throw new EventParseError("UNKNOWN_KIND", `unknown kind: ${kind}`);
  }
  const missing = required.filter((f) => fields[f] === undefined);
  if (missing.length > 0) {
    throw new EventParseError(
      "MISSING_FIELDS",
      `the event ${kind} is missing fields: ${missing.join(", ")}`,
    );
  }
  if (NEP141_KINDS.has(kind)) {
    fields.amount = normalizeNep141Amount(fields.amount);
    // Old `ft_burn` logs carry no `memo`; the NEP-141 shape emits `memo: null`.
    if (kind === "ft_burn" && fields.memo === undefined) {
      fields.memo = null;
    }
    if (
      fields.memo !== undefined &&
      fields.memo !== null &&
      typeof fields.memo !== "string"
    ) {
      throw new EventParseError("INVALID_JSON", `NEP-141 memo must be a string or null, got: ${typeof fields.memo}`);
    }
  }
  return { kind, ...fields } as unknown as SnaccEvent;
}

/**
 * Parse one log line into a `SnaccEvent`.
 * - Lines that are not events (neither prefixed with `EVENT_JSON:`/`{` nor a
 *   `subaccount_materialized ...`) → `null`.
 * - A line that looks like an event but is broken → `EventParseError` (a controlled error).
 */
export function parseEventLine(line: string): SnaccEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith("EVENT_JSON:") || trimmed.startsWith("{")) {
    const fields = unwrap(trimmed);
    const kind = fields.kind;
    if (typeof kind !== "string" || !KNOWN_KINDS.has(kind)) {
      throw new EventParseError(
        "UNKNOWN_KIND",
        `unknown kind: ${String(kind)}`,
      );
    }
    return buildEvent(kind, fields);
  }

  if (trimmed.startsWith("subaccount_materialized")) {
    const fields: Record<string, unknown> = { kind: "subaccount_materialized" };
    const pairRe = /([A-Za-z_][A-Za-z0-9_]*)=([^\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(trimmed)) !== null) {
      const key = m[1];
      const value = m[2];
      if (key === undefined || value === undefined) continue;
      if (key === "strain_id") {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          throw new EventParseError("INVALID_JSON", `strain_id is not a number: ${value}`);
        }
        fields.strain_id = n;
      } else if (key !== "kind") {
        fields[key] = value;
      }
    }
    return buildEvent("subaccount_materialized", fields);
  }

  return null; // not an event (an ordinary contract log)
}

/** Parse many lines at once; non-event lines are skipped. */
export function parseEventLines(lines: string[]): SnaccEvent[] {
  const out: SnaccEvent[] = [];
  for (const line of lines) {
    const ev = parseEventLine(line);
    if (ev !== null) out.push(ev);
  }
  return out;
}
