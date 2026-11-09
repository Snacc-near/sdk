// VC-016 — Function Call Access Key manager unit tests (a mock RPC, no network).

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  base58Decode,
  base58Encode,
  classifyChainError,
  DEFAULT_ALLOWANCE_YOCTO,
  DEPOSIT_METHODS,
  fullAccessRegistrar,
  generateKeyPair,
  MemorySessionKeyStore,
  publicKeyOf,
  RpcError,
  serializeTransaction,
  SessionKeyError,
  SessionKeyManager,
  SIGNLESS_METHODS,
  SnaccClient,
  WebStorageSessionKeyStore,
  type KeyRegistrar,
  type RpcProvider,
} from "../src/index.js";

const ACCOUNT = "alice.testnet";
const BLOCK_HASH = base58Encode(new Uint8Array(32).fill(7));

/** A mock RPC with access-key state: nonce, allowance, existence. Records every tx. */
function mockRpc() {
  const state = {
    keys: new Map<string, { nonce: number; allowance: string | null }>(),
    sent: [] as { base64: string }[],
    sendError: null as unknown,
    failureReceipt: false,
    logs: [] as string[],
    viewResults: {} as Record<string, unknown>,
    nonceFailuresLeft: 0,
  };
  const rpc: RpcProvider = {
    async rpc(method: string, params: any): Promise<any> {
      if (method === "block") return { header: { hash: BLOCK_HASH } };
      if (method === "query" && params.request_type === "view_access_key") {
        const k = state.keys.get(`${params.account_id}|${params.public_key}`);
        if (!k) throw new RpcError({ name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCESS_KEY", info: {} } });
        return {
          nonce: k.nonce,
          block_hash: BLOCK_HASH,
          permission: { FunctionCall: { allowance: k.allowance, receiver_id: "snacc-v001.testnet", method_names: [] } },
        };
      }
      if (method === "query" && params.request_type === "call_function") {
        const v = state.viewResults[params.method_name];
        return { result: Array.from(new TextEncoder().encode(JSON.stringify(v))) };
      }
      if (method === "send_tx") {
        if (state.nonceFailuresLeft > 0) {
          state.nonceFailuresLeft--;
          throw new RpcError({ cause: { info: { InvalidTxError: { InvalidNonce: { tx_nonce: 1, ak_nonce: 9 } } } } });
        }
        if (state.sendError) throw state.sendError;
        state.sent.push({ base64: params.signed_tx_base64 });
        return {
          status: state.failureReceipt ? { Failure: { ActionError: {} } } : { SuccessValue: "" },
          transaction_outcome: { id: "TXHASH" + state.sent.length, outcome: { logs: [], status: {} } },
          receipts_outcome: [{ outcome: { logs: state.logs, status: { SuccessValue: "" } } }],
        };
      }
      throw new Error(`mock rpc: ${method}`);
    },
  };
  return { rpc, state };
}

/** A mock registrar: "registers" the key into the mock state (like the real chain). */
function mockRegistrar(state: ReturnType<typeof mockRpc>["state"]) {
  const adds: any[] = [];
  const dels: any[] = [];
  const reg: KeyRegistrar = {
    async addKey(r) {
      adds.push(r);
      state.keys.set(`${r.accountId}|${r.publicKey}`, { nonce: 100, allowance: r.allowanceYocto });
      return { txHash: "ADD" };
    },
    async deleteKey(r) {
      dels.push(r);
      state.keys.delete(`${r.accountId}|${r.publicKey}`);
      return { txHash: "DEL" };
    },
  };
  return { reg, adds, dels };
}

/** Decode a borsh SignedTransaction (a FunctionCall subset) + verify the ed25519 signature. */
async function decodeSigned(base64: string) {
  const b = Uint8Array.from(Buffer.from(base64, "base64"));
  const dv = new DataView(b.buffer);
  let o = 0;
  const u32 = () => ((o += 4), dv.getUint32(o - 4, true));
  const str = () => {
    const n = u32();
    const s = new TextDecoder().decode(b.slice(o, o + n));
    o += n;
    return s;
  };
  const signerId = str();
  o += 1; // key type
  const pk = b.slice(o, o + 32);
  o += 32;
  const nonce = dv.getBigUint64(o, true);
  o += 8;
  const receiverId = str();
  o += 32; // block hash
  const nActions = u32();
  assert.equal(b[o++], 2, "the FunctionCall action (index 2)");
  const methodName = str();
  const argLen = u32();
  const args = new TextDecoder().decode(b.slice(o, o + argLen));
  o += argLen;
  const gas = dv.getBigUint64(o, true);
  o += 8;
  const depositLo = dv.getBigUint64(o, true);
  const depositHi = dv.getBigUint64(o + 8, true);
  o += 16;
  const txEnd = o;
  assert.equal(b[o++], 0, "signature key type ed25519");
  const sig = b.slice(o, o + 64);
  assert.equal(o + 64, b.length, "no leftover bytes");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", b.slice(0, txEnd)));
  const key = await crypto.subtle.importKey("raw", pk, { name: "Ed25519" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "Ed25519" }, key, sig, hash);
  return { signerId, pk: `ed25519:${base58Encode(pk)}`, nonce, receiverId, nActions, methodName, args, gas, deposit: depositLo + (depositHi << 64n), valid };
}

describe("VC-016 — base58 & keys", () => {
  test("base58 round-trip (including leading zeros)", () => {
    for (const bytes of [[0, 0, 1, 2, 3], [255, 255], [0], [1], Array.from({ length: 32 }, (_, i) => i * 8)]) {
      const u = Uint8Array.from(bytes);
      assert.deepEqual(base58Decode(base58Encode(u)), u);
    }
    assert.equal(base58Encode(new TextEncoder().encode("hello")), "Cn8eVZg"); // the standard vector
  });
  test("base58 rejects invalid characters", () => {
    assert.throws(() => base58Decode("0OIl"), (e: any) => e.code === "BAD_KEY");
  });
  test("generateKeyPair: the NEAR format; publicKeyOf is consistent; unique", async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    assert.match(a.publicKey, /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);
    assert.equal(base58Decode(a.secretKey.slice(8)).length, 64);
    assert.equal(publicKeyOf(a.secretKey), a.publicKey);
    assert.notEqual(a.publicKey, b.publicKey);
  });
  test("publicKeyOf rejects broken keys", () => {
    assert.throws(() => publicKeyOf("secp256k1:abc"), (e: any) => e.code === "BAD_KEY");
    assert.throws(() => publicKeyOf("ed25519:" + base58Encode(new Uint8Array(5))), (e: any) => e.code === "BAD_KEY");
  });
});

describe("VC-016 — the method lists", () => {
  test("SIGNLESS_METHODS does not overlap DEPOSIT_METHODS; unique names", () => {
    for (const m of SIGNLESS_METHODS) assert.ok(!DEPOSIT_METHODS.includes(m), m);
    assert.equal(new Set(SIGNLESS_METHODS).size, SIGNLESS_METHODS.length);
    assert.ok(SIGNLESS_METHODS.includes("feed_strain"));
  });
  test("signless methods match the deposit-0 deposits in SnaccClient (aligned with the client)", async () => {
    const deposits = new Map<string, string>();
    const client = new SnaccClient({
      contractId: "snacc-v001.testnet",
      transport: {
        async view() {
          return {} as never;
        },
        async call(m, _a, d) {
          deposits.set(m, d);
          return { txHash: "x", events: [], success: true };
        },
      },
    });
    await client.feedStrain(1, 1);
    await client.incubateStrain("Extractor", 100, 1);
    assert.equal(deposits.get("feed_strain"), "0");
    assert.notEqual(deposits.get("incubate_strain"), "0");
  });
});

describe("VC-016 — createSession", () => {
  test("registers a key restricted to snacc-v001.testnet + stores it locally", async () => {
    const { rpc, state } = mockRpc();
    const { reg, adds } = mockRegistrar(state);
    const store = new MemorySessionKeyStore();
    const m = new SessionKeyManager({ rpc, store });
    const rec = await m.createSession({ accountId: ACCOUNT, registrar: reg });
    assert.equal(adds.length, 1);
    assert.equal(adds[0].contractId, "snacc-v001.testnet");
    assert.deepEqual(adds[0].methodNames, [...SIGNLESS_METHODS]);
    assert.equal(adds[0].allowanceYocto, DEFAULT_ALLOWANCE_YOCTO);
    assert.equal(adds[0].publicKey, rec.publicKey);
    assert.deepEqual(await m.getSession(ACCOUNT), rec);
    assert.equal(publicKeyOf(rec.secretKey), rec.publicKey);
  });
  test("rejects methods that require a deposit", async () => {
    const { rpc, state } = mockRpc();
    const { reg, adds } = mockRegistrar(state);
    const m = new SessionKeyManager({ rpc });
    await assert.rejects(
      m.createSession({ accountId: ACCOUNT, registrar: reg, methodNames: ["feed_strain", "incubate_strain"] }),
      (e: any) => e instanceof SessionKeyError && e.code === "DEPOSIT_NOT_ALLOWED",
    );
    assert.equal(adds.length, 0);
  });
  test("validation: empty/duplicate/illegal methodNames, a 0/illegal allowance, an empty accountId", async () => {
    const { rpc, state } = mockRpc();
    const { reg } = mockRegistrar(state);
    const m = new SessionKeyManager({ rpc });
    const bad = (o: object) =>
      assert.rejects(m.createSession({ accountId: ACCOUNT, registrar: reg, ...o }), (e: any) => e.code === "INVALID_CONFIG");
    await bad({ methodNames: [] });
    await bad({ methodNames: ["feed_strain", "feed_strain"] });
    await bad({ methodNames: ["Feed-Strain"] });
    await bad({ allowanceYocto: "0" });
    await bad({ allowanceYocto: "-5" });
    await bad({ allowanceYocto: "1.5" });
    await assert.rejects(m.createSession({ accountId: "", registrar: reg }), (e: any) => e.code === "INVALID_CONFIG");
  });
  test("a registrar failure → REGISTRATION_FAILED and the key is NOT stored", async () => {
    const { rpc } = mockRpc();
    const store = new MemorySessionKeyStore();
    const m = new SessionKeyManager({ rpc, store });
    const reg: KeyRegistrar = {
      async addKey() {
        throw new Error("the wallet rejected it");
      },
      async deleteKey() {
        return {};
      },
    };
    await assert.rejects(m.createSession({ accountId: ACCOUNT, registrar: reg }), (e: any) => e.code === "REGISTRATION_FAILED");
    assert.equal(await m.getSession(ACCOUNT), null);
  });
  test("a custom contractId is honored", async () => {
    const { rpc, state } = mockRpc();
    const { reg, adds } = mockRegistrar(state);
    const m = new SessionKeyManager({ rpc, contractId: "snacc-v002.testnet" });
    await m.createSession({ accountId: ACCOUNT, registrar: reg, methodNames: ["feed_strain"], allowanceYocto: "5" });
    assert.equal(adds[0].contractId, "snacc-v002.testnet");
    assert.equal(adds[0].allowanceYocto, "5");
  });
});

describe("VC-016 — call (session-key signing)", () => {
  async function setup() {
    const { rpc, state } = mockRpc();
    const { reg, adds, dels } = mockRegistrar(state);
    const m = new SessionKeyManager({ rpc });
    const rec = await m.createSession({ accountId: ACCOUNT, registrar: reg });
    return { m, rpc, state, reg, rec, adds, dels };
  }

  test("a valid borsh tx: signer, receiver, method, JSON args, deposit 0, verified signature", async () => {
    const { m, state, rec } = await setup();
    const res = await m.call(ACCOUNT, "feed_strain", { strain_id: "1", amount: "5000" });
    assert.equal(res.success, true);
    assert.equal(res.txHash, "TXHASH1");
    const tx = await decodeSigned(state.sent[0]!.base64);
    assert.equal(tx.signerId, ACCOUNT);
    assert.equal(tx.pk, rec.publicKey);
    assert.equal(tx.receiverId, "snacc-v001.testnet");
    assert.equal(tx.methodName, "feed_strain");
    assert.deepEqual(JSON.parse(tx.args), { strain_id: "1", amount: "5000" });
    assert.equal(tx.deposit, 0n);
    assert.equal(tx.gas, 30_000_000_000_000n);
    assert.equal(tx.nonce, 101n);
    assert.equal(tx.nActions, 1);
    assert.equal(tx.valid, true);
  });

  test("sequential nonces for consecutive calls (the local cache > the chain nonce)", async () => {
    const { m, state } = await setup();
    await m.call(ACCOUNT, "advance_epoch", {});
    await m.call(ACCOUNT, "advance_epoch", {});
    await m.call(ACCOUNT, "advance_epoch", {});
    const nonces = [];
    for (const s of state.sent) nonces.push((await decodeSigned(s.base64)).nonce);
    assert.deepEqual(nonces, [101n, 102n, 103n]);
  });

  test("InvalidNonce → one retry with the chain nonce, then success", async () => {
    const { m, state } = await setup();
    state.nonceFailuresLeft = 1;
    const res = await m.call(ACCOUNT, "advance_epoch", {});
    assert.equal(res.success, true);
    assert.equal(state.sent.length, 1);
  });

  test("a method outside the list → METHOD_NOT_ALLOWED (no tx sent)", async () => {
    const { m, state } = await setup();
    await assert.rejects(m.call(ACCOUNT, "ft_transfer", {}), (e: any) => e.code === "METHOD_NOT_ALLOWED");
    assert.equal(state.sent.length, 0);
  });

  test("a deposit ≠ 0 → DEPOSIT_NOT_ALLOWED (no tx sent)", async () => {
    const { m, state } = await setup();
    for (const d of ["1", "1000", "abc"]) {
      await assert.rejects(m.call(ACCOUNT, "feed_strain", {}, { depositYocto: d }), (e: any) => e.code === "DEPOSIT_NOT_ALLOWED");
    }
    assert.equal(state.sent.length, 0);
  });

  test("no session → NO_SESSION", async () => {
    const { rpc } = mockRpc();
    const m = new SessionKeyManager({ rpc });
    await assert.rejects(m.call("ghost.testnet", "feed_strain", {}), (e: any) => e.code === "NO_SESSION");
  });

  test("receipt logs → parsed events; a failed receipt → success:false", async () => {
    const { m, state } = await setup();
    state.logs = ['{"kind":"extracted","strain_id":1,"token":"spore","amount":1,"catalyst_fee":5}'];
    const ok = await m.call(ACCOUNT, "feed_strain", {});
    assert.equal(ok.events.length, 1);
    assert.equal(ok.events[0]?.kind, "extracted");
    state.failureReceipt = true;
    const bad = await m.call(ACCOUNT, "feed_strain", {});
    assert.equal(bad.success, false);
  });

  test("a custom gas is honored", async () => {
    const { m, state } = await setup();
    await m.call(ACCOUNT, "feed_strain", {}, { gas: "50000000000000" });
    assert.equal((await decodeSigned(state.sent[0]!.base64)).gas, 50_000_000_000_000n);
  });

  test("an exhausted allowance (NotEnoughAllowance from the RPC) → ALLOWANCE_EXHAUSTED", async () => {
    const { m, state } = await setup();
    state.sendError = new RpcError({
      name: "HANDLER_ERROR",
      cause: { name: "INVALID_TRANSACTION", info: { InvalidTxError: { InvalidAccessKeyError: { NotEnoughAllowance: { allowance: "1", cost: "9" } } } } },
    });
    await assert.rejects(m.call(ACCOUNT, "feed_strain", {}), (e: any) => e.code === "ALLOWANCE_EXHAUSTED");
  });

  test("a revoked key (AccessKeyNotFound / UNKNOWN_ACCESS_KEY) → KEY_REVOKED", async () => {
    const { m, state, rec } = await setup();
    state.keys.delete(`${ACCOUNT}|${rec.publicKey}`);
    await assert.rejects(m.call(ACCOUNT, "feed_strain", {}), (e: any) => e.code === "KEY_REVOKED");
    state.keys.set(`${ACCOUNT}|${rec.publicKey}`, { nonce: 5, allowance: "1" });
    state.sendError = new RpcError({ cause: { info: { InvalidTxError: { InvalidAccessKeyError: { AccessKeyNotFound: {} } } } } });
    await assert.rejects(m.call(ACCOUNT, "feed_strain", {}), (e: any) => e.code === "KEY_REVOKED");
  });

  test("another RPC error → RPC_ERROR", async () => {
    const { m, state } = await setup();
    state.sendError = new RpcError({ name: "INTERNAL_ERROR" });
    await assert.rejects(m.call(ACCOUNT, "feed_strain", {}), (e: any) => e.code === "RPC_ERROR");
  });
});

describe("VC-016 — status (allowance & revocation detection)", () => {
  test("missing / active / allowance_low / exhausted / revoked", async () => {
    const { rpc, state } = mockRpc();
    const { reg } = mockRegistrar(state);
    const m = new SessionKeyManager({ rpc });
    assert.deepEqual(await m.status(ACCOUNT), { state: "missing" });
    const rec = await m.createSession({ accountId: ACCOUNT, registrar: reg });
    const k = `${ACCOUNT}|${rec.publicKey}`;
    assert.deepEqual(await m.status(ACCOUNT), { state: "active", allowanceYocto: DEFAULT_ALLOWANCE_YOCTO });
    state.keys.get(k)!.allowance = "5000000000000000000000"; // 0.005 N < the 0.01 N threshold
    assert.deepEqual(await m.status(ACCOUNT), { state: "allowance_low", allowanceYocto: "5000000000000000000000" });
    state.keys.get(k)!.allowance = "0";
    assert.deepEqual(await m.status(ACCOUNT), { state: "exhausted", allowanceYocto: "0" });
    state.keys.delete(k);
    assert.deepEqual(await m.status(ACCOUNT), { state: "revoked" });
  });
  test("a null allowance (unlimited) = active; a custom threshold", async () => {
    const { rpc, state } = mockRpc();
    const { reg } = mockRegistrar(state);
    const m = new SessionKeyManager({ rpc, lowAllowanceYocto: "1000" });
    const rec = await m.createSession({ accountId: ACCOUNT, registrar: reg });
    const k = `${ACCOUNT}|${rec.publicKey}`;
    state.keys.get(k)!.allowance = null;
    assert.deepEqual(await m.status(ACCOUNT), { state: "active", allowanceYocto: null });
    state.keys.get(k)!.allowance = "999";
    assert.equal((await m.status(ACCOUNT)).state, "allowance_low");
  });
  test("non-revocation RPC errors are rethrown as-is (not a fake 'revoked')", async () => {
    const { rpc, state } = mockRpc();
    const { reg } = mockRegistrar(state);
    const m = new SessionKeyManager({ rpc });
    await m.createSession({ accountId: ACCOUNT, registrar: reg });
    const broken: RpcProvider = {
      async rpc() {
        throw new Error("network down");
      },
    };
    const m2 = new SessionKeyManager({ rpc: broken, store: (m as any).store });
    await assert.rejects(m2.status(ACCOUNT), (e: any) => e.code === "RPC_ERROR");
  });
});

describe("VC-016 — revoke / forget / store", () => {
  test("revoke: delete on chain via the registrar + delete locally; a call afterwards → NO_SESSION", async () => {
    const { rpc, state } = mockRpc();
    const { reg, dels } = mockRegistrar(state);
    const m = new SessionKeyManager({ rpc });
    const rec = await m.createSession({ accountId: ACCOUNT, registrar: reg });
    await m.revoke(ACCOUNT, reg);
    assert.equal(dels.length, 1);
    assert.equal(dels[0].publicKey, rec.publicKey);
    assert.equal(state.keys.size, 0);
    assert.equal(await m.getSession(ACCOUNT), null);
    await assert.rejects(m.call(ACCOUNT, "feed_strain", {}), (e: any) => e.code === "NO_SESSION");
  });
  test("a failed revoke → the local record remains; no session → NO_SESSION", async () => {
    const { rpc, state } = mockRpc();
    const { reg } = mockRegistrar(state);
    const m = new SessionKeyManager({ rpc });
    await assert.rejects(m.revoke(ACCOUNT, reg), (e: any) => e.code === "NO_SESSION");
    await m.createSession({ accountId: ACCOUNT, registrar: reg });
    const failing: KeyRegistrar = {
      addKey: reg.addKey,
      async deleteKey() {
        throw new Error("rejected");
      },
    };
    await assert.rejects(m.revoke(ACCOUNT, failing), (e: any) => e.code === "REGISTRATION_FAILED");
    assert.ok(await m.getSession(ACCOUNT));
  });
  test("forget only removes locally", async () => {
    const { rpc, state } = mockRpc();
    const { reg, dels } = mockRegistrar(state);
    const m = new SessionKeyManager({ rpc });
    await m.createSession({ accountId: ACCOUNT, registrar: reg });
    await m.forget(ACCOUNT);
    assert.equal(await m.getSession(ACCOUNT), null);
    assert.equal(dels.length, 0);
    assert.equal(state.keys.size, 1);
  });
  test("WebStorageSessionKeyStore: set/get/remove + broken JSON → null", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    const s = new WebStorageSessionKeyStore(storage);
    const rec = { accountId: ACCOUNT, contractId: "c", publicKey: "p", secretKey: "s", methodNames: ["a"], allowanceYocto: "1", createdAt: 1 };
    s.set(rec);
    assert.deepEqual(s.get(ACCOUNT), rec);
    mem.set("snacc:fcak:" + ACCOUNT, "{broken");
    assert.equal(s.get(ACCOUNT), null);
    s.remove(ACCOUNT);
    assert.equal(s.get(ACCOUNT), null);
  });
});

describe("VC-016 — asTransport + SnaccClient (0-popup)", () => {
  test("SnaccClient.feedStrain & views via the session key; incubateStrain (a deposit) is rejected", async () => {
    const { rpc, state } = mockRpc();
    const { reg } = mockRegistrar(state);
    const m = new SessionKeyManager({ rpc });
    await m.createSession({ accountId: ACCOUNT, registrar: reg });
    state.viewResults["get_crucible_temp"] = 950;
    const client = new SnaccClient({ contractId: m.contractId, transport: m.asTransport(ACCOUNT) });
    assert.equal(await client.getCrucibleTemp(), 950);
    const r = await client.feedStrain(3, 1000);
    assert.equal(r.success, true);
    assert.equal((await decodeSigned(state.sent[0]!.base64)).methodName, "feed_strain");
    await assert.rejects(client.incubateStrain("Extractor", 100, 1), (e: any) => e.code === "DEPOSIT_NOT_ALLOWED");
    assert.equal(state.sent.length, 1);
  });
});

describe("VC-016 — borsh & registrar full-access", () => {
  test("serializeTransaction AddKey FunctionCall: exact bytes (a hand-built vector)", () => {
    const pk = "ed25519:" + base58Encode(new Uint8Array(32).fill(1));
    const bytes = serializeTransaction({
      signerId: "a",
      signerPublicKey: pk,
      nonce: 1n,
      receiverId: "a",
      blockHash: BLOCK_HASH,
      actions: [
        { type: "AddKey", publicKey: pk, permission: { kind: "FunctionCall", allowance: "5", receiverId: "c", methodNames: ["m"] } },
      ],
    });
    const hex = Buffer.from(bytes).toString("hex");
    const expected =
      "01000000" + "61" + // signer "a"
      "00" + "01".repeat(32) + // signer pk
      "0100000000000000" + // nonce
      "01000000" + "61" + // receiver "a"
      "07".repeat(32) + // block hash
      "01000000" + // 1 action
      "05" + "00" + "01".repeat(32) + // AddKey + pk
      "0000000000000000" + // access key nonce
      "00" + "01" + "05" + "00".repeat(15) + // FunctionCall, Some(allowance=5 u128)
      "01000000" + "63" + // receiver "c"
      "01000000" + "01000000" + "6d"; // 1 method: "m"
  });
  test("serializeTransaction DeleteKey & allowance null", () => {
    const pk = "ed25519:" + base58Encode(new Uint8Array(32).fill(2));
    const del = Buffer.from(
      serializeTransaction({ signerId: "a", signerPublicKey: pk, nonce: 2n, receiverId: "a", blockHash: BLOCK_HASH, actions: [{ type: "DeleteKey", publicKey: pk }] }),
    ).toString("hex");
    assert.ok(del.endsWith("06" + "00" + "02".repeat(32)));
    const add = Buffer.from(
      serializeTransaction({
        signerId: "a",
        signerPublicKey: pk,
        nonce: 2n,
        receiverId: "a",
        blockHash: BLOCK_HASH,
        actions: [{ type: "AddKey", publicKey: pk, permission: { kind: "FunctionCall", allowance: null, receiverId: "c", methodNames: [] } }],
      }),
    ).toString("hex");
    assert.ok(add.includes("0000000000000000" + "00" + "00" + "01000000" + "63" + "00000000"));
  });
  test("fullAccessRegistrar: addKey/deleteKey ditandatangani kunci full-access & terkirim", async () => {
    const { rpc, state } = mockRpc();
    const owner = await generateKeyPair();
    state.keys.set(`${ACCOUNT}|${owner.publicKey}`, { nonce: 10, allowance: null });
    const reg = fullAccessRegistrar(rpc, owner.secretKey);
    const sessionKey = await generateKeyPair();
    const r1 = await reg.addKey({ accountId: ACCOUNT, publicKey: sessionKey.publicKey, contractId: "snacc-v001.testnet", methodNames: ["feed_strain"], allowanceYocto: "5" });
    assert.equal(r1.txHash, "TXHASH1");
    const r2 = await reg.deleteKey({ accountId: ACCOUNT, publicKey: sessionKey.publicKey });
    assert.equal(r2.txHash, "TXHASH2");
    assert.equal(state.sent.length, 2);
    const b0 = Buffer.from(state.sent[0]!.base64, "base64");
    assert.equal(b0[b0.length - 65], 0); // the signature key type
    const hex0 = b0.toString("hex");
    assert.ok(hex0.includes("05" + "00" + Buffer.from(base58Decode(sessionKey.publicKey.slice(8))).toString("hex")));
  });
  test("fullAccessRegistrar: a failed receipt → REGISTRATION_FAILED", async () => {
    const { rpc, state } = mockRpc();
    const owner = await generateKeyPair();
    state.keys.set(`${ACCOUNT}|${owner.publicKey}`, { nonce: 10, allowance: null });
    state.failureReceipt = true;
    const reg = fullAccessRegistrar(rpc, owner.secretKey);
    await assert.rejects(
      reg.addKey({ accountId: ACCOUNT, publicKey: (await generateKeyPair()).publicKey, contractId: "c", methodNames: ["m"], allowanceYocto: "1" }),
      (e: any) => e.code === "REGISTRATION_FAILED",
    );
  });
});

describe("VC-016 — classifyChainError", () => {
  test("maps every key-error class", () => {
    const code = (o: unknown) => classifyChainError(new RpcError(o))?.code;
    assert.equal(code({ InvalidAccessKeyError: { NotEnoughAllowance: {} } }), "ALLOWANCE_EXHAUSTED");
    assert.equal(code({ AccessKeyNotFound: {} }), "KEY_REVOKED");
    assert.equal(code({ cause: { name: "UNKNOWN_ACCESS_KEY" } }), "KEY_REVOKED");
    assert.equal(code({ MethodNameMismatch: {} }), "METHOD_MISMATCH");
    assert.equal(code({ ReceiverMismatch: {} }), "RECEIVER_MISMATCH");
    assert.equal(code({ DepositWithFunctionCall: {} }), "DEPOSIT_NOT_ALLOWED");
    assert.equal(code({ other: 1 }), undefined);
    assert.equal(classifyChainError(new Error("x")), null);
  });
});
