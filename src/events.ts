// SDK-107..108 — parser event kontrak `snacc-v001.near` untuk `lab-sdk` (M4).
//
// Format rujukan PERSIS dari `repos/Snacc/contracts/snacc/src/lib.rs` (pemanggilan
// `events::emit_event_json`) dan `lib.rs:239` (log sub-account). Empat event JSON yang
// SUDAH dipancarkan kontrak (bentuk saat ini: satu baris JSON dengan field `kind`):
//
//   {"kind":"strain_created","strain_id":N,"owner_id":"...","role_mask":N,"initial_snacc_stake":N,"spores_minted":N}
//   {"kind":"extracted","strain_id":N,"token":"...","amount":1,"catalyst_fee":N}
//   {"kind":"transmuted","strain_id":N,"burned_spores":N,"token_out":"...","minted":N,"catalyst_fee":N}
//   {"kind":"synthesized","strain_id":N,"token_out":"...","minted":N,"enzymes_burned":N,"catalyst_fee":N}
//
// Ditambah log non-JSON (lib.rs:239):
//   subaccount_materialized strain_id=N sub_account_id=s-<id>.snacc-v001.near
//
// Parser juga menerima pembungkus NEP-297 baku `EVENT_JSON:{...}` (VC-010 akan memakai
// bentuk ini): objek dengan `data: [payload]` dan `event` (atau `kind`) di level atas.
//
// AMBIGUITAS (dicatat, tidak diarang):
// A1. `emit_event_json` di kontrak masih stub `TODO(VC-010)` — prefix `EVENT_JSON:` belum
//     benar-benar terpasang; parser mendukung kedua bentuk (polos & berprefix) agar tidak
//     perlu diubah saat VC-010 merge.
// A2. Nilai u128 (`initial_snacc_stake`, `catalyst_fee`) diparse sebagai `number` JSON;
//     nilai di atas 2^53 kehilangan presisi — perlakuan BigInt diseragamkan belakangan
//     bersama `SnaccClient` (VC-016..019).

/** Error terkontrol untuk log yang terindikasi event tetapi tidak bisa diparse. */
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

export type SnaccEvent =
  | StrainCreatedEvent
  | ExtractedEvent
  | TransmutedEvent
  | SynthesizedEvent
  | SubaccountMaterializedEvent;

const KNOWN_KINDS = new Set([
  "strain_created",
  "extracted",
  "transmuted",
  "synthesized",
  "subaccount_materialized",
]);

/** Field wajib per kind — salin persis dari format `lib.rs`. */
const REQUIRED_FIELDS: Record<string, string[]> = {
  strain_created: ["strain_id", "owner_id", "role_mask", "initial_snacc_stake", "spores_minted"],
  extracted: ["strain_id", "token", "amount", "catalyst_fee"],
  transmuted: ["strain_id", "burned_spores", "token_out", "minted", "catalyst_fee"],
  synthesized: ["strain_id", "token_out", "minted", "enzymes_burned", "catalyst_fee"],
  subaccount_materialized: ["strain_id", "sub_account_id"],
};

/** Buka pembungkus NEP-297 baku (`EVENT_JSON:` + `data: [...]`) bila ada. */
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
      `bukan JSON valid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new EventParseError("NOT_AN_EVENT_OBJECT", "event harus objek JSON");
  }

  const record = obj as Record<string, unknown>;
  // Bentuk NEP-297 baku: { standard, version, event, data: [payload] }.
  if (Array.isArray(record.data)) {
    const payload = record.data[0];
    if (typeof payload !== "object" || payload === null) {
      throw new EventParseError("NOT_AN_EVENT_OBJECT", "data[0] harus objek");
    }
    const inner = payload as Record<string, unknown>;
    if (typeof record.event === "string" && inner.kind === undefined) {
      return { ...inner, kind: record.event };
    }
    return inner as Record<string, unknown>;
  }
  return record;
}

/** Validasi field wajib per kind, lalu kembalikan event bertipe. */
function buildEvent(kind: string, fields: Record<string, unknown>): SnaccEvent {
  const required = REQUIRED_FIELDS[kind];
  if (required === undefined) {
    throw new EventParseError("UNKNOWN_KIND", `kind tidak dikenal: ${kind}`);
  }
  const missing = required.filter((f) => fields[f] === undefined);
  if (missing.length > 0) {
    throw new EventParseError(
      "MISSING_FIELDS",
      `event ${kind} kurang field: ${missing.join(", ")}`,
    );
  }
  return { kind, ...fields } as unknown as SnaccEvent;
}

/**
 * Parse satu baris log menjadi `SnaccEvent`.
 * - Baris yang bukan event (tidak berawalan `EVENT_JSON:`/`{` dan bukan
 *   `subaccount_materialized ...`) → `null`.
 * - Baris terindikasi event tetapi rusak → `EventParseError` (error terkontrol).
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
        `kind tidak dikenal: ${String(kind)}`,
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
          throw new EventParseError("INVALID_JSON", `strain_id bukan angka: ${value}`);
        }
        fields.strain_id = n;
      } else if (key !== "kind") {
        fields[key] = value;
      }
    }
    return buildEvent("subaccount_materialized", fields);
  }

  return null; // bukan event (log biasa kontrak)
}

/** Parse banyak baris sekaligus; baris non-event dilewati. */
export function parseEventLines(lines: string[]): SnaccEvent[] {
  const out: SnaccEvent[] = [];
  for (const line of lines) {
    const ev = parseEventLine(line);
    if (ev !== null) out.push(ev);
  }
  return out;
}
