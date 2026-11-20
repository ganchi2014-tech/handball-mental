// 実行: node tests/link-pin.test.js
// LABとつなぐときのPIN（割り出し・照合用の形・データベースへ置く処理）を、index.html から関数を取り出して確かめる。
// 本物のデータベースには触らない（置く処理は身代わりに差しかえる）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const from = html.indexOf('    // ====== Hash for PIN ======');
const to = html.indexOf('    // 保存形式（v1/v2）を自動判別して検証');
assert.ok(from > 0 && to > from, 'index.html の中に目印が見つからない');
const src = html.slice(from, to);

function makeEnv() {
  const store = {};
  const saved = [];
  const env = {
    crypto: require('crypto').webcrypto, TextEncoder, console: { debug() {}, warn() {}, log() {} },
    PIN_KEY: 'mental_pin_hash',
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    storage: { saveLinkPin: async (uid, hash) => { if (env.failSave) throw new Error('PERMISSION_DENIED'); saved.push({ uid, hash }); } },
    failSave: false,
  };
  vm.createContext(env);
  vm.runInContext(src + '\nthis.api = { hashPin, hashPinV2, recoverPin, linkPinHash, ensureLinkPin, LINK_PIN_CACHE_KEY };', env);
  return { env, store, saved, api: env.api };
}

let passed = 0;
const jobs = [];
function t(name, fn) { jobs.push(async () => { try { await fn(); passed++; console.log('PASS', name); } catch (e) { console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } }); }

// handball-system の tests/link-pin.test.js と同じ値。片方だけ変わったら、正しいPINでもつながらなくなる。
const KNOWN = '2ea9cc4dda73238f785a360edea79ed76f5143f0470598d969a7d7d768d78a45';

t('照合用の形は LAB と同じ作り方（決まった入力に決まった答え）', async () => {
  const { api } = makeEnv();
  assert.strictEqual(await api.linkPinHash('uidX', '1234'), KNOWN);
});
t('今の形（v2）から元のPINを割り出せる', async () => {
  const { api } = makeEnv();
  for (const pin of ['0000', '0420', '9999']) assert.strictEqual(await api.recoverPin(await api.hashPinV2(pin)), pin);
});
t('古い形（v1）から元のPINを割り出せる', async () => {
  const { api } = makeEnv();
  for (const pin of ['0007', '9876']) assert.strictEqual(await api.recoverPin(api.hashPin(pin)), pin);
});
t('形が無い・こわれているときは null（決め直してもらう）', async () => {
  const { api } = makeEnv();
  assert.strictEqual(await api.recoverPin(''), null);
  assert.strictEqual(await api.recoverPin(null), null);
  assert.strictEqual(await api.recoverPin('v2:00ff:deadbeef'), null);
  assert.strictEqual(await api.recoverPin('123456789'), null);
});
t('顧問の6桁のPINは割り出さない（4桁だけ）', async () => {
  const { api } = makeEnv();
  assert.strictEqual(await api.recoverPin(await api.hashPinV2('123456')), null);
});
t('データベースに置くのは照合用の形だけ（PINそのものは置かない・控えない）', async () => {
  const { api, store, saved } = makeEnv();
  store['mental_pin_hash'] = await api.hashPinV2('4321');
  assert.strictEqual(await api.ensureLinkPin('uidA'), true);
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].uid, 'uidA');
  assert.strictEqual(saved[0].hash, await api.linkPinHash('uidA', '4321'));
  assert.strictEqual(saved[0].hash.length, 64);
  assert.ok(!JSON.stringify(saved).includes('4321'));
  assert.ok(!store[api.LINK_PIN_CACHE_KEY].includes('"4321"'));
});
t('2回目からは割り出し直さない（控えた形を使う）', async () => {
  const { api, store, saved, env } = makeEnv();
  store['mental_pin_hash'] = await api.hashPinV2('4321');
  await api.ensureLinkPin('uidA');
  let called = 0; const orig = env.crypto.subtle.digest.bind(env.crypto.subtle);
  env.crypto = { subtle: { digest: (...a) => { called++; return orig(...a); } } };
  await api.ensureLinkPin('uidA');
  assert.strictEqual(called, 0);
  assert.strictEqual(saved.length, 2);
});
t('PINを決め直したら、形も作り直す', async () => {
  const { api, store, saved } = makeEnv();
  store['mental_pin_hash'] = await api.hashPinV2('1111');
  await api.ensureLinkPin('uidA');
  store['mental_pin_hash'] = await api.hashPinV2('2222');
  await api.ensureLinkPin('uidA');
  assert.strictEqual(saved[1].hash, await api.linkPinHash('uidA', '2222'));
});
t('データベースの決まりがまだ入っていなくても止まらない（false を返すだけ）', async () => {
  const { api, store, env } = makeEnv();
  store['mental_pin_hash'] = await api.hashPinV2('4321');
  env.failSave = true;
  assert.strictEqual(await api.ensureLinkPin('uidA'), false);
});
t('PINの形が無い端末では何も置かない', async () => {
  const { api, saved } = makeEnv();
  assert.strictEqual(await api.ensureLinkPin('uidA'), false);
  assert.strictEqual(saved.length, 0);
});
t('いちばん遅い場合（9999）の割り出しにかかる時間を出す', async () => {
  const { api } = makeEnv();
  const h = await api.hashPinV2('9999');
  const t0 = Date.now(); await api.recoverPin(h); const ms = Date.now() - t0;
  console.log('   かかった時間:', ms, 'ミリ秒（この機械で）');
  assert.ok(ms < 20000);
});

(async () => { for (const j of jobs) await j(); console.log(`\n${passed}/${jobs.length} 件通った`); })();
