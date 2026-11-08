// VC-016 — uji integrasi testnet (akun faucet BARU per run; kunci hanya di memori, tidak disimpan/ditampilkan).
// Dilewati kecuali `SNACC_TESTNET_IT=1` agar `npm test` tetap offline/deterministik.
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
  throw new Error("akun faucet tidak muncul di chain");
}

test("VC-016 integrasi testnet: buat → call tanpa popup → status → mismatch → habis → cabut", { skip: !RUN, timeout: 240_000 }, async () => {
  const rpc = new JsonRpcProvider();
  const { accountId, owner } = await newFaucetAccount(rpc);
  const registrar = fullAccessRegistrar(rpc, owner.secretKey);
  const mgr = new SessionKeyManager({ rpc });

  // 1. buat sesi: kunci terbatas ke snacc-v001.testnet
  const rec = await mgr.createSession({ accountId, registrar, methodNames: ["feed_strain", "advance_epoch"], allowanceYocto: "250000000000000000000000" });
  const onChain = await rpc.rpc<any>("query", { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: rec.publicKey });
  const fc = onChain.permission.FunctionCall;
  assert.equal(fc.receiver_id, "snacc-v001.testnet");
  assert.deepEqual([...fc.method_names].sort(), ["advance_epoch", "feed_strain"]);
  assert.equal(fc.allowance, "250000000000000000000000");
  const st0 = await mgr.status(accountId);
  assert.equal(st0.state, "active");

  // 2. panggilan game tanpa popup (feed strain milik akun lain → ditolak kontrak, tapi tx bertanda tangan sah masuk chain)
  const r = await mgr.call(accountId, "feed_strain", { strain_id: "1", amount: "1" });
  assert.ok(r.txHash.length > 30, "tx hash");
  assert.equal(r.success, false, "kontrak menolak (bukan pemilik strain) — bukan error tanda tangan");
  const st1 = await mgr.status(accountId);
  assert.equal(st1.state, "active");
  assert.ok(BigInt((st1 as any).allowanceYocto) < 250000000000000000000000n, "allowance berkurang setelah tx");

  // 3. view lewat transport sesi (bacaan nyata)
  const temp = await mgr.asTransport(accountId).view<number>("get_crucible_temp", {});
  assert.equal(typeof temp, "number");

  // 4. method di luar izin ditolak CHAIN (tx mentah, melewati pengaman lokal) → METHOD_MISMATCH
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

  // 5. cabut lewat pemilik → status revoked (dari chain), call → KEY_REVOKED
  const rec2 = await mgr.createSession({ accountId, registrar, methodNames: ["feed_strain"] }); // menimpa rekaman lokal
  const dropDirect: KeyRegistrar = registrar;
  await dropDirect.deleteKey({ accountId, publicKey: rec2.publicKey }); // dicabut di luar manajer
  assert.deepEqual(await mgr.status(accountId), { state: "revoked" });
  await assert.rejects(mgr.call(accountId, "feed_strain", { strain_id: "1", amount: "1" }), (e: any) => e.code === "KEY_REVOKED");

  // 6. allowance habis: allowance 1e19 yocto < biaya prabayar gas → NotEnoughAllowance dari chain
  const rec3 = await mgr.createSession({ accountId, registrar, methodNames: ["feed_strain"], allowanceYocto: "10000000000000000000" });
  await assert.rejects(mgr.call(accountId, "feed_strain", { strain_id: "1", amount: "1" }), (e: any) => e.code === "ALLOWANCE_EXHAUSTED");

  // 7. revoke manajer: kunci hilang di chain + lokal
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
