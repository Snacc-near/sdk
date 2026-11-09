// VC-016 — the Function Call Access Key (FCAK) manager for signless (0-popup) lab sessions.
// Spec: ADR-08 (Design Decisions), M4 (Module Map), `docs/nep611-signless.md`.
//
// Design:
// - Dependency-free: ed25519 via WebCrypto (`globalThis.crypto.subtle`, Node ≥ 20 & modern browsers),
//   the borsh transaction serialization is hand-written (only FunctionCall / AddKey / DeleteKey actions).
// - The RPC is injected (`RpcProvider`) → unit tests use a mock; `JsonRpcProvider` is the `fetch` implementation.
// - Key storage is injected (`SessionKeyStore`): memory, or a `localStorage`-like object.
//
// PROTOCOL CONSTRAINT (honest): transactions signed by a function-call key MUST NOT carry a deposit
// (NEAR rejects `DepositWithFunctionCall`). Therefore the contract methods that require a deposit
// (`incubate_strain`, `materialize_subaccount`, `extract_spores`, `transmute_spores_to_enzyme`,
// `synthesize_elixir`, `nft_transfer*`, `ft_transfer*`, `storage_deposit`) cannot be signless and
// are rejected locally (`DEPOSIT_NOT_ALLOWED`) — those still go through the wallet. Only the deposit-0 methods in `SIGNLESS_METHODS` are signless.
import { eventsFromTxResult, type Transport, type TxResult } from "./client.js";

export const SESSION_CONTRACT_ID = "snacc-v001.testnet";
/** ADR-08: allowance sesi default 0,25 NEAR. */
export const DEFAULT_ALLOWANCE_YOCTO = "250000000000000000000000";
/** Below this threshold a session is considered nearly exhausted (`allowance_low`): 0.01 NEAR. */
export const LOW_ALLOWANCE_YOCTO = "10000000000000000000000";
export const DEFAULT_GAS = "30000000000000"; // 30 TGas

/** Contract methods called with a 0 deposit (safe for a function-call key). */
export const SIGNLESS_METHODS: readonly string[] = [
  "allocate_atp",
  "feed_strain",
  "commit_genome_experiment",
  "apply_tee_mutation_zero_trust",
  "splice_strains",
  "hostile_takeover_splice",
  "adopt",
  "divide_strain",
  "harvest_starving_strain",
  "conjugate_traits",
  "npc_buy_spores",
  "synthesize_and_redeem_aether",
  "claim_industrial_dividend",
  "advance_epoch",
  "ft_burn",
];

/** Methods that require a deposit → cannot use a FCAK (still the wallet). */
export const DEPOSIT_METHODS: readonly string[] = [
  "incubate_strain",
  "materialize_subaccount",
  "extract_spores",
  "transmute_spores_to_enzyme",
  "synthesize_elixir",
  "nft_transfer",
  "nft_transfer_call",
  "ft_transfer",
  "ft_transfer_call",
  "storage_deposit",
  "storage_unregister",
];

export type SessionKeyErrorCode =
  | "INVALID_CONFIG"
  | "NO_SESSION"
  | "METHOD_NOT_ALLOWED"
  | "DEPOSIT_NOT_ALLOWED"
  | "ALLOWANCE_EXHAUSTED"
  | "KEY_REVOKED"
  | "METHOD_MISMATCH"
  | "RECEIVER_MISMATCH"
  | "REGISTRATION_FAILED"
  | "RPC_ERROR"
  | "BAD_KEY";

export class SessionKeyError extends Error {
  constructor(
    public readonly code: SessionKeyErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SessionKeyError";
  }
}

// ─── base58 / bytes ───

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]!];
  return out;
}

export function base58Decode(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < s.length; i++) {
    const v = B58.indexOf(s[i]!);
    if (v < 0) throw new SessionKeyError("BAD_KEY", `invalid base58 character: ${s[i]}`);
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i]!;
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ─── ed25519 keys (the NEAR format: `ed25519:<base58>`, secret = seed‖pub, 64 bytes) ───

const PKCS8_ED25519_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export interface SessionKeyPair {
  publicKey: string; // "ed25519:..."
  secretKey: string; // "ed25519:..." (64 byte)
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new SessionKeyError("INVALID_CONFIG", "WebCrypto (crypto.subtle) is unavailable");
  return s;
}

export async function generateKeyPair(): Promise<SessionKeyPair> {
  const kp = (await subtle().generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await subtle().exportKey("pkcs8", kp.privateKey));
  const seed = pkcs8.slice(pkcs8.length - 32);
  const pub = new Uint8Array(await subtle().exportKey("raw", kp.publicKey));
  const secret = new Uint8Array(64);
  secret.set(seed, 0);
  secret.set(pub, 32);
  return { publicKey: `ed25519:${base58Encode(pub)}`, secretKey: `ed25519:${base58Encode(secret)}` };
}

function parseKey(k: string, expectLen: number[]): Uint8Array {
  if (!k.startsWith("ed25519:")) throw new SessionKeyError("BAD_KEY", "the key must be prefixed with ed25519:");
  const b = base58Decode(k.slice("ed25519:".length));
  if (!expectLen.includes(b.length)) throw new SessionKeyError("BAD_KEY", `invalid key length ${b.length}`);
  return b;
}

/** Derive the public key from a NEAR secret key (64 bytes seed‖pub). */
export function publicKeyOf(secretKey: string): string {
  const b = parseKey(secretKey, [64]);
  return `ed25519:${base58Encode(b.slice(32))}`;
}

async function signBytes(secretKey: string, msg: Uint8Array): Promise<Uint8Array> {
  const seed = parseKey(secretKey, [64]).slice(0, 32);
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
  pkcs8.set(PKCS8_ED25519_PREFIX, 0);
  pkcs8.set(seed, PKCS8_ED25519_PREFIX.length);
  const key = await subtle().importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
  return new Uint8Array(await subtle().sign({ name: "Ed25519" }, key, msg as BufferSource));
}

// ─── borsh (subset) ───

class BorshWriter {
  private parts: number[] = [];
  u8(v: number) {
    this.parts.push(v & 0xff);
    return this;
  }
  u32(v: number) {
    for (let i = 0; i < 4; i++) this.parts.push((v >>> (8 * i)) & 0xff);
    return this;
  }
  private big(v: bigint, bytes: number) {
    if (v < 0n) throw new SessionKeyError("INVALID_CONFIG", "negative number");
    for (let i = 0; i < bytes; i++) this.parts.push(Number((v >> BigInt(8 * i)) & 0xffn));
    return this;
  }
  u64(v: bigint) {
    return this.big(v, 8);
  }
  u128(v: bigint) {
    return this.big(v, 16);
  }
  raw(b: Uint8Array) {
    for (const x of b) this.parts.push(x);
    return this;
  }
  bytes(b: Uint8Array) {
    return this.u32(b.length).raw(b);
  }
  str(s: string) {
    return this.bytes(new TextEncoder().encode(s));
  }
  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

export type SessionAction =
  | { type: "FunctionCall"; methodName: string; args: Uint8Array; gas: string; deposit: string }
  | {
      type: "AddKey";
      publicKey: string;
      permission:
        | { kind: "FunctionCall"; allowance: string | null; receiverId: string; methodNames: string[] }
        | { kind: "FullAccess" };
    }
  | { type: "DeleteKey"; publicKey: string };

function writePublicKey(w: BorshWriter, pk: string) {
  w.u8(0).raw(parseKey(pk, [32]));
}

function writeAction(w: BorshWriter, a: SessionAction) {
  if (a.type === "FunctionCall") {
    w.u8(2).str(a.methodName).bytes(a.args).u64(BigInt(a.gas)).u128(BigInt(a.deposit));
  } else if (a.type === "AddKey") {
    w.u8(5);
    writePublicKey(w, a.publicKey);
    w.u64(0n); // the initial access-key nonce (the chain overwrites it with block_height << 20)
    if (a.permission.kind === "FullAccess") {
      w.u8(1);
    } else {
      w.u8(0);
      if (a.permission.allowance === null) w.u8(0);
      else w.u8(1).u128(BigInt(a.permission.allowance));
      w.str(a.permission.receiverId);
      w.u32(a.permission.methodNames.length);
      for (const m of a.permission.methodNames) w.str(m);
    }
  } else {
    w.u8(6);
    writePublicKey(w, a.publicKey);
  }
}

export interface TxInput {
  signerId: string;
  signerPublicKey: string;
  nonce: bigint;
  receiverId: string;
  blockHash: string; // base58
  actions: SessionAction[];
}

export function serializeTransaction(t: TxInput): Uint8Array {
  const w = new BorshWriter();
  w.str(t.signerId);
  writePublicKey(w, t.signerPublicKey);
  w.u64(t.nonce).str(t.receiverId).raw(parseKey("ed25519:" + t.blockHash, [32]));
  w.u32(t.actions.length);
  for (const a of t.actions) writeAction(w, a);
  return w.done();
}

/** Sign a transaction → a borsh SignedTransaction (base64, ready for `send_tx`). */
export async function signTransaction(t: TxInput, secretKey: string): Promise<{ base64: string; hashB58: string }> {
  const txBytes = serializeTransaction(t);
  const hash = new Uint8Array(await subtle().digest("SHA-256", txBytes as BufferSource));
  const sig = await signBytes(secretKey, hash);
  const signed = new BorshWriter().raw(txBytes).u8(0).raw(sig).done();
  return { base64: toBase64(signed), hashB58: base58Encode(hash) };
}

// ─── RPC ───

export interface RpcProvider {
  /** JSON-RPC; throws an `RpcError` for `error` objects. */
  rpc<T = any>(method: string, params: unknown): Promise<T>;
}

export class RpcError extends Error {
  constructor(public readonly rpcError: unknown) {
    super(`RPC error: ${safeJson(rpcError).slice(0, 300)}`);
    this.name = "RpcError";
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export class JsonRpcProvider implements RpcProvider {
  constructor(
    // `rpc.testnet.near.org` is deprecated (HTTP -429) → FastNEAR by default.
    private readonly url: string = "https://test.rpc.fastnear.com",
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}
  async rpc<T>(method: string, params: unknown): Promise<T> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "snacc", method, params }),
    });
    const json = (await res.json()) as { result?: T; error?: unknown };
    if (json.error !== undefined) throw new RpcError(json.error);
    return json.result as T;
  }
}

/** Look for a key named `name` anywhere inside the object (for nested RPC errors). */
function hasKey(v: unknown, name: string): boolean {
  if (v === null || typeof v !== "object") return false;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k === name || hasKey(val, name)) return true;
  }
  return false;
}

/** Map RPC errors / tx failures to controlled `SessionKeyError`s; `null` when unrecognized. */
export function classifyChainError(e: unknown): SessionKeyError | null {
  const raw = e instanceof RpcError ? e.rpcError : e;
  const text = safeJson(raw);
  if (hasKey(raw, "NotEnoughAllowance") || text.includes("NotEnoughAllowance"))
    return new SessionKeyError("ALLOWANCE_EXHAUSTED", "the function-call key allowance is exhausted", e);
  if (hasKey(raw, "AccessKeyNotFound") || text.includes("AccessKeyNotFound") || text.includes("UNKNOWN_ACCESS_KEY") || /does not exist while viewing/.test(text))
    return new SessionKeyError("KEY_REVOKED", "the access key does not exist on chain (revoked/not yet registered)", e);
  if (hasKey(raw, "MethodNameMismatch") || text.includes("MethodNameMismatch"))
    return new SessionKeyError("METHOD_MISMATCH", "the method is not allowed by the access key", e);
  if (hasKey(raw, "ReceiverMismatch") || text.includes("ReceiverMismatch"))
    return new SessionKeyError("RECEIVER_MISMATCH", "the receiver does not match the access key", e);
  if (hasKey(raw, "DepositWithFunctionCall") || text.includes("DepositWithFunctionCall"))
    return new SessionKeyError("DEPOSIT_NOT_ALLOWED", "a function-call key cannot carry a deposit", e);
  return null;
}

// ─── storage ───

export interface SessionRecord {
  accountId: string;
  contractId: string;
  publicKey: string;
  secretKey: string;
  methodNames: string[];
  allowanceYocto: string;
  createdAt: number;
}

export interface SessionKeyStore {
  get(accountId: string): Promise<SessionRecord | null> | SessionRecord | null;
  set(rec: SessionRecord): Promise<void> | void;
  remove(accountId: string): Promise<void> | void;
}

export class MemorySessionKeyStore implements SessionKeyStore {
  private m = new Map<string, SessionRecord>();
  get(a: string) {
    return this.m.get(a) ?? null;
  }
  set(r: SessionRecord) {
    this.m.set(r.accountId, r);
  }
  remove(a: string) {
    this.m.delete(a);
  }
}

/** A `localStorage`/`sessionStorage` adapter (or a similar-shaped object). */
export class WebStorageSessionKeyStore implements SessionKeyStore {
  constructor(
    private readonly storage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void },
    private readonly prefix = "snacc:fcak:",
  ) {}
  get(a: string): SessionRecord | null {
    const s = this.storage.getItem(this.prefix + a);
    if (!s) return null;
    try {
      return JSON.parse(s) as SessionRecord;
    } catch {
      return null;
    }
  }
  set(r: SessionRecord) {
    this.storage.setItem(this.prefix + r.accountId, JSON.stringify(r));
  }
  remove(a: string) {
    this.storage.removeItem(this.prefix + a);
  }
}

// ─── key registrar (the account owner) ───

/** Registers/revokes keys on the player's account. Frontend: a wallet implementation; backend/tests: `fullAccessSigner`. */
export interface KeyRegistrar {
  addKey(req: {
    accountId: string;
    publicKey: string;
    contractId: string;
    methodNames: string[];
    allowanceYocto: string;
  }): Promise<{ txHash?: string }>;
  deleteKey(req: { accountId: string; publicKey: string }): Promise<{ txHash?: string }>;
}

/** A registrar that signs `AddKey`/`DeleteKey` with the account's full-access key (tests, a backend relayer, onboarding). */
export function fullAccessRegistrar(rpc: RpcProvider, fullAccessSecretKey: string): KeyRegistrar {
  const pk = publicKeyOf(fullAccessSecretKey);
  const send = async (accountId: string, action: SessionAction) => {
    const out = await sendActions(rpc, accountId, pk, fullAccessSecretKey, accountId, [action]);
    if (!out.success) throw new SessionKeyError("REGISTRATION_FAILED", `transaction ${out.txHash} failed`);
    return { txHash: out.txHash };
  };
  return {
    addKey: (r) =>
      send(r.accountId, {
        type: "AddKey",
        publicKey: r.publicKey,
        permission: { kind: "FunctionCall", allowance: r.allowanceYocto, receiverId: r.contractId, methodNames: r.methodNames },
      }),
    deleteKey: (r) => send(r.accountId, { type: "DeleteKey", publicKey: r.publicKey }),
  };
}

// ─── kirim transaksi bertanda tangan ───

interface ExecOutcome {
  txHash: string;
  success: boolean;
  logs: string[];
}

const nonceCache = new Map<string, bigint>();

async function accessKeyInfo(rpc: RpcProvider, accountId: string, publicKey: string) {
  try {
    const r = await rpc.rpc<any>("query", {
      request_type: "view_access_key",
      finality: "optimistic",
      account_id: accountId,
      public_key: publicKey,
    });
    if (r && typeof r === "object" && "error" in r && r.error) throw new RpcError(r.error);
    return r as { nonce: number | string; permission: unknown; block_hash: string };
  } catch (e) {
    const c = classifyChainError(e);
    if (c) throw c;
    throw new SessionKeyError("RPC_ERROR", `view_access_key failed: ${(e as Error).message}`, e);
  }
}

async function sendActions(
  rpc: RpcProvider,
  signerId: string,
  signerPublicKey: string,
  signerSecretKey: string,
  receiverId: string,
  actions: SessionAction[],
): Promise<ExecOutcome> {
  const cacheKey = `${signerId}|${signerPublicKey}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const info = await accessKeyInfo(rpc, signerId, signerPublicKey);
    const chainNonce = BigInt(info.nonce);
    const local = nonceCache.get(cacheKey) ?? 0n;
    const nonce = (attempt === 0 && local > chainNonce ? local : chainNonce) + 1n;
    const block = await rpc.rpc<any>("block", { finality: "final" });
    const { base64 } = await signTransaction(
      { signerId, signerPublicKey, nonce, receiverId, blockHash: block.header.hash, actions },
      signerSecretKey,
    );
    try {
      const res = await rpc.rpc<any>("send_tx", { signed_tx_base64: base64, wait_until: "EXECUTED" });
      nonceCache.set(cacheKey, nonce);
      return parseOutcome(res);
    } catch (e) {
      if (attempt === 0 && safeJson(e instanceof RpcError ? e.rpcError : e).includes("InvalidNonce")) continue;
      const c = classifyChainError(e);
      if (c) throw c;
      throw new SessionKeyError("RPC_ERROR", `send_tx failed: ${(e as Error).message}`, e);
    }
  }
  throw new SessionKeyError("RPC_ERROR", "the nonce is out of sync after retry");
}

function parseOutcome(res: any): ExecOutcome {
  const logs: string[] = [];
  const outs: any[] = [res?.transaction_outcome, ...(res?.receipts_outcome ?? [])].filter(Boolean);
  for (const o of outs) for (const l of o.outcome?.logs ?? []) logs.push(l);
  const failed = hasKey(res?.status, "Failure") || outs.some((o) => hasKey(o.outcome?.status, "Failure"));
  const txHash: string = res?.transaction_outcome?.id ?? res?.transaction?.hash ?? "";
  return { txHash, success: !failed, logs };
}

// ─── manajer ───

export type SessionStatus =
  | { state: "active"; allowanceYocto: string | null }
  | { state: "allowance_low"; allowanceYocto: string }
  | { state: "exhausted"; allowanceYocto: string }
  | { state: "revoked" }
  | { state: "missing" };

export interface SessionKeyManagerOptions {
  rpc: RpcProvider;
  store?: SessionKeyStore;
  contractId?: string;
  /** Ambang `allowance_low` (yocto). */
  lowAllowanceYocto?: string;
}

export interface CreateSessionOptions {
  accountId: string;
  registrar: KeyRegistrar;
  methodNames?: string[];
  allowanceYocto?: string;
}

export interface SessionCallOptions {
  gas?: string;
  /** Must be "0" (the default) — a function-call key cannot carry a deposit. */
  depositYocto?: string;
}

export class SessionKeyManager {
  readonly contractId: string;
  private readonly rpc: RpcProvider;
  private readonly store: SessionKeyStore;
  private readonly lowAllowance: bigint;

  constructor(opts: SessionKeyManagerOptions) {
    this.rpc = opts.rpc;
    this.store = opts.store ?? new MemorySessionKeyStore();
    this.contractId = opts.contractId ?? SESSION_CONTRACT_ID;
    this.lowAllowance = BigInt(opts.lowAllowanceYocto ?? LOW_ALLOWANCE_YOCTO);
  }

  /** Create a new keypair, register it on the account via the `registrar`, store it locally on success. */
  async createSession(opts: CreateSessionOptions): Promise<SessionRecord> {
    const methodNames = [...(opts.methodNames ?? SIGNLESS_METHODS)];
    const allowanceYocto = opts.allowanceYocto ?? DEFAULT_ALLOWANCE_YOCTO;
    if (!opts.accountId) throw new SessionKeyError("INVALID_CONFIG", "accountId is required");
    if (methodNames.length === 0) throw new SessionKeyError("INVALID_CONFIG", "methodNames must not be empty (that would mean every method)");
    if (new Set(methodNames).size !== methodNames.length) throw new SessionKeyError("INVALID_CONFIG", "duplicate methodNames");
    for (const m of methodNames) {
      if (DEPOSIT_METHODS.includes(m))
        throw new SessionKeyError("DEPOSIT_NOT_ALLOWED", `${m} requires a deposit — it cannot use a function-call key`);
      if (!/^[a-z_][a-z0-9_]*$/.test(m)) throw new SessionKeyError("INVALID_CONFIG", `invalid method name: ${m}`);
    }
    if (!/^\d+$/.test(allowanceYocto) || BigInt(allowanceYocto) <= 0n)
      throw new SessionKeyError("INVALID_CONFIG", "the allowance must be > 0 (yocto, a decimal string)");

    const kp = await generateKeyPair();
    try {
      await opts.registrar.addKey({
        accountId: opts.accountId,
        publicKey: kp.publicKey,
        contractId: this.contractId,
        methodNames,
        allowanceYocto,
      });
    } catch (e) {
      if (e instanceof SessionKeyError) throw e;
      throw new SessionKeyError("REGISTRATION_FAILED", `key registration failed: ${(e as Error).message}`, e);
    }
    const rec: SessionRecord = {
      accountId: opts.accountId,
      contractId: this.contractId,
      publicKey: kp.publicKey,
      secretKey: kp.secretKey,
      methodNames,
      allowanceYocto,
      createdAt: Date.now(),
    };
    await this.store.set(rec);
    return rec;
  }

  async getSession(accountId: string): Promise<SessionRecord | null> {
    return (await this.store.get(accountId)) ?? null;
  }

  /** The session status from the chain: `missing` (no local record), `revoked`, `exhausted`, `allowance_low`, `active`. */
  async status(accountId: string): Promise<SessionStatus> {
    const rec = await this.getSession(accountId);
    if (!rec) return { state: "missing" };
    let info: Awaited<ReturnType<typeof accessKeyInfo>>;
    try {
      info = await accessKeyInfo(this.rpc, accountId, rec.publicKey);
    } catch (e) {
      if (e instanceof SessionKeyError && e.code === "KEY_REVOKED") return { state: "revoked" };
      throw e;
    }
    const perm = (info.permission as any)?.FunctionCall;
    if (!perm) return { state: "active", allowanceYocto: null }; // full access / another shape
    if (perm.allowance === null || perm.allowance === undefined) return { state: "active", allowanceYocto: null };
    const allowance = BigInt(perm.allowance);
    if (allowance === 0n) return { state: "exhausted", allowanceYocto: "0" };
    if (allowance < this.lowAllowance) return { state: "allowance_low", allowanceYocto: allowance.toString() };
    return { state: "active", allowanceYocto: allowance.toString() };
  }

  /** A contract call signed by the session key — no wallet popup. */
  async call(accountId: string, method: string, args: Record<string, unknown>, opts: SessionCallOptions = {}): Promise<TxResult> {
    const rec = await this.getSession(accountId);
    if (!rec) throw new SessionKeyError("NO_SESSION", `no session for ${accountId}`);
    const deposit = opts.depositYocto ?? "0";
    if (!/^\d+$/.test(deposit) || BigInt(deposit) !== 0n)
      throw new SessionKeyError("DEPOSIT_NOT_ALLOWED", `${method}: a function-call key cannot carry a deposit (${deposit})`);
    if (!rec.methodNames.includes(method))
      throw new SessionKeyError("METHOD_NOT_ALLOWED", `${method} is not in the session's method list`);
    const out = await sendActions(
      this.rpc,
      accountId,
      rec.publicKey,
      rec.secretKey,
      rec.contractId,
      [{ type: "FunctionCall", methodName: method, args: new TextEncoder().encode(JSON.stringify(args)), gas: opts.gas ?? DEFAULT_GAS, deposit }],
    );
    return { txHash: out.txHash, success: out.success, logs: out.logs, events: eventsFromTxResult(out) };
  }

  /** A `Transport` for `SnaccClient`: views via RPC, calls via the session key (a deposit ≠ 0 is rejected). */
  asTransport(accountId: string): Transport {
    return {
      view: async <T>(method: string, args: Record<string, unknown>) => {
        const r = await this.rpc.rpc<any>("query", {
          request_type: "call_function",
          finality: "optimistic",
          account_id: this.contractId,
          method_name: method,
          args_base64: toBase64(new TextEncoder().encode(JSON.stringify(args))),
        });
        return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result as number[]))) as T;
      },
      call: (method, args, attachedDepositYocto) => this.call(accountId, method, args, { depositYocto: attachedDepositYocto }),
    };
  }

  /** Revoke the key on chain (via the account owner) then remove the local record. */
  async revoke(accountId: string, registrar: KeyRegistrar): Promise<void> {
    const rec = await this.getSession(accountId);
    if (!rec) throw new SessionKeyError("NO_SESSION", `no session for ${accountId}`);
    try {
      await registrar.deleteKey({ accountId, publicKey: rec.publicKey });
    } catch (e) {
      if (e instanceof SessionKeyError) throw e;
      throw new SessionKeyError("REGISTRATION_FAILED", `key revocation failed: ${(e as Error).message}`, e);
    }
    await this.store.remove(accountId);
    nonceCache.delete(`${accountId}|${rec.publicKey}`);
  }

  /** Remove only the local record (e.g. the key was already revoked on chain). */
  async forget(accountId: string): Promise<void> {
    const rec = await this.getSession(accountId);
    await this.store.remove(accountId);
    if (rec) nonceCache.delete(`${accountId}|${rec.publicKey}`);
  }
}
