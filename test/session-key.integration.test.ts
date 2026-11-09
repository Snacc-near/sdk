// VC-016 — testnet integration test (a NEW faucet account per run; the keys stay in memory, never stored/shown).
// Skipped unless `SNACC_TESTNET_IT=1` so `npm test` stays offline/deterministic.
//   SNACC_TESTNET_IT=1 npm test

import assert from "node:assert/strict";
import test from "node:test";

import {
  base58Encode,
  fullAccessRegistrar,
  generateKeyPair,
  JsonRpcProvider,
  SessionKeyManager,
  signTransaction,
  classifyChainError,
  RpcError,
  type KeyRegistrar,
} from "../src/index.js";

const RUN = process.env.SNACC_TESTNET_IT === "1";
const HELPER = "https://helper.testnet.near.org/account";

async function newFaucetAccount(rpc: JsonRpcProvider) {
  const accountId = `fcak-it-${Date.now()}-${Math.floor(Math.random() * 1e4)}.testnet`;
  const owner = await generateKeyPair();
  const res = await fetch(HELPER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: owner.publicKey }),
  });
  assert.ok(res.ok, `faucet helper HTTP ${res.status}`);
  for (let i = 0; i < 20; i++) {
    try {
      await rpc.rpc("query", { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: owner.publicKey });
      return { accountId, owner };
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("the faucet account did not appear on chain");
}

test("VC-016 testnet integration: create → call without a popup → status → mismatch → exhausted → revoke", { skip: !RUN, timeout: 240_000 }, async () => {
  const rpc = new JsonRpcProvider();
  const { accountId, owner } = await newFaucetAccount(rpc);
  const registrar = fullAccessRegistrar(rpc, owner.secretKey);
  const mgr = new SessionKeyManager({ rpc });

  // 1. create the session: the key is restricted to snacc-v001.testnet
  const rec = await mgr.createSession({ accountId, registrar, methodNames: ["feed_strain", "advance_epoch"], allowanceYocto: "250000000000000000000000" });
  const onChain = await rpc.rpc<any>("query", { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: rec.publicKey });
  const fc = onChain.permission.FunctionCall;
  assert.equal(fc.receiver_id, "snacc-v001.testnet");
  assert.deepEqual([...fc.method_names].sort(), ["advance_epoch", "feed_strain"]);
  assert.equal(fc.allowance, "250000000000000000000000");
  const st0 = await mgr.status(accountId);
  assert.equal(st0.state, "active");

  // 2. a game call without a popup (feeding a strain owned by another account → the contract rejects it,
  // but the correctly signed tx still lands on chain)
  const r = await mgr.call(accountId, "feed_strain", { strain_id: "1", amount: "1" });
  assert.ok(r.txHash.length > 30, "tx hash");
  assert.equal(r.success, false, "the contract rejects it (not the strain owner) — not a signature error");
  const st1 = await mgr.status(accountId);
  assert.equal(st1.state, "active");
  assert.ok(BigInt((st1 as any).allowanceYocto) < 250000000000000000000000n, "the allowance shrank after the tx");

  // 3. a view through the session transport (a real read)
  const temp = await mgr.asTransport(accountId).view<number>("get_crucible_temp", {});
  assert.equal(typeof temp, "number");

  // 4. a method outside the allowlist is rejected by the CHAIN (a raw tx, bypassing the local guard) → METHOD_MISMATCH
  const info = await rpc.rpc<any>("query", { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: rec.publicKey });
  const block = await rpc.rpc<any>("block", { finality: "final" });
  const bad = await signTransaction(
    {
      signerId: accountId,
      signerPublicKey: rec.publicKey,
      nonce: BigInt(info.nonce) + 1n,
      receiverId: "snacc-v001.testnet",
      blockHash: block.header.hash,
      actions: [{ type: "FunctionCall", methodName: "ft_burn", args: new TextEncoder().encode("{}"), gas: "30000000000000", deposit: "0" }],
    },
    rec.secretKey,
  );
  await assert.rejects(rpc.rpc("send_tx", { signed_tx_base64: bad.base64, wait_until: "EXECUTED" }), (e: unknown) => {
    assert.ok(e instanceof RpcError);
    assert.equal(classifyChainError(e)?.code, "METHOD_MISMATCH");
    return true;
  });

  // 5. revoke via the owner → the status is revoked (from the chain), a call → KEY_REVOKED
  const rec2 = await mgr.createSession({ accountId, registrar, methodNames: ["feed_strain"] }); // overwrites the local record
  const dropDirect: KeyRegistrar = registrar;
  await dropDirect.deleteKey({ accountId, publicKey: rec2.publicKey }); // revoked outside the manager
  assert.deepEqual(await mgr.status(accountId), { state: "revoked" });
  await assert.rejects(mgr.call(accountId, "feed_strain", { strain_id: "1", amount: "1" }), (e: any) => e.code === "KEY_REVOKED");

  // 6. an exhausted allowance: 1e19 yocto < the prepaid gas cost → NotEnoughAllowance from the chain
  const rec3 = await mgr.createSession({ accountId, registrar, methodNames: ["feed_strain"], allowanceYocto: "10000000000000000000" });
  await assert.rejects(mgr.call(accountId, "feed_strain", { strain_id: "1", amount: "1" }), (e: any) => e.code === "ALLOWANCE_EXHAUSTED");

  // 7. manager revoke: the key disappears on chain + locally
  await mgr.revoke(accountId, registrar);
  assert.equal(await mgr.getSession(accountId), null);
  await assert.rejects(
    rpc.rpc("query", { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: rec3.publicKey }).then((r: any) => {
      if (r?.error) throw new RpcError(r.error);
    }),
    (e: unknown) => classifyChainError(e)?.code === "KEY_REVOKED",
  );
  void base58Encode;
});
