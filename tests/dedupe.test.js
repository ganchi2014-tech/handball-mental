// 実行: node tests/dedupe.test.js
const assert = require('assert');
const D = require('../lib/dedupe.js');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('PASS', name); }
  catch (e) { console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; }
}

// --- normalizeSurname ---
t('全角空白・前後空白を除去', () => assert.strictEqual(D.normalizeSurname(' 赤　塚 '), '赤塚'));
t('全半角を統一(NFKC)', () => assert.strictEqual(D.normalizeSurname('ｵｶﾞﾜ'), 'オガワ'));
t('null/undefinedは空文字', () => assert.strictEqual(D.normalizeSurname(null), ''));

// --- findRosterDuplicates ---
const roster = {
  a: { surname: '関山', enrollmentYear: 2026 },
  b: { surname: '関山', enrollmentYear: 2026 },   // a の重複
  c: { surname: '岩噌', enrollmentYear: 2026 },
  d: { surname: '岩噌', enrollmentYear: 2024 },   // 入学年度違い = 別人
  e: { surname: '関 山', enrollmentYear: 2026 }   // 空白違いも同一視
};
t('同姓同年度をグループ化・別年度は除外', () => {
  const groups = D.findRosterDuplicates(roster);
  assert.strictEqual(groups.length, 1);
  assert.deepStrictEqual(groups[0].entries.map(x => x.id).sort(), ['a', 'b', 'e']);
});

// --- planMerge ---
const group = { key: '関山|2026', entries: [{ id: 'a' }, { id: 'b' }, { id: 'e' }] };
t('連携済みが1つ→それが統合先・uid移動なし', () => {
  const p = D.planMerge(group, { b: 'uid1' });
  assert.strictEqual(p.canonicalId, 'b');
  assert.strictEqual(p.moveUid, null);
  assert.deepStrictEqual(p.deleteIds.sort(), ['a', 'e']);
  assert.strictEqual(p.conflict, false);
});
t('統合先を手動指定→連携uidを移動', () => {
  const p = D.planMerge(group, { b: 'uid1' }, 'a');
  assert.strictEqual(p.canonicalId, 'a');
  assert.strictEqual(p.moveUid, 'uid1');
  assert.deepStrictEqual(p.unlinkIds, ['b']);
  assert.strictEqual(p.conflict, false);
});
t('複数行が別uidに連携→conflict', () => {
  const p = D.planMerge(group, { a: 'uid1', b: 'uid2' });
  assert.strictEqual(p.conflict, true);
});
t('連携なし→先頭が統合先', () => {
  const p = D.planMerge(group, {});
  assert.strictEqual(p.canonicalId, 'a');
  assert.strictEqual(p.conflict, false);
});

// --- csvGameId / resolveCsvRows ---
t('gameIdは日付_相手（記号除去）', () =>
  assert.strictEqual(D.csvGameId({ date: '2026-07-01', opponent: '県立A高' }), '2026-07-01_県立A高'));

const nameToRid = { '①関山': 'a', '関山': 'a', '②小川': 'g', '小川': 'g' };
t('攻撃行はplayer・守備行はgkで紐付け', () => {
  const r = D.resolveCsvRows([
    { date: '2026-07-01', opponent: 'A', mode: 'attack', player: '①関山', result: 'goal' },
    { date: '2026-07-01', opponent: 'A', mode: 'defense', player: '', gk: '②小川', result: 'save' }
  ], nameToRid, {});
  const g = r.byGame['2026-07-01_A'];
  assert.strictEqual(g.byRid.a.length, 1);
  assert.strictEqual(g.byRid.g.length, 1);
  assert.strictEqual(r.matchedRows, 2);
});
t('学年記号ズレは姓でフォールバック（②関山→関山）', () => {
  const r = D.resolveCsvRows([{ date: 'd', opponent: 'A', mode: 'attack', player: '②関山', result: 'goal' }], nameToRid, {});
  assert.strictEqual(r.byGame['d_A'].byRid.a.length, 1);
});
t('未知の名前はunmatchedに集約', () => {
  const r = D.resolveCsvRows([{ date: 'd', opponent: 'A', mode: 'attack', player: '③謎田', result: 'goal' }], nameToRid, {});
  assert.deepStrictEqual(r.unmatched, ['③謎田']);
  assert.strictEqual(r.matchedRows, 0);
});
t('manualMapで解決・skipで除外', () => {
  const rows = [
    { date: 'd', opponent: 'A', mode: 'attack', player: '③謎田', result: 'goal' },
    { date: 'd', opponent: 'A', mode: 'attack', player: 'ゴミ行', result: 'goal' }
  ];
  const r = D.resolveCsvRows(rows, nameToRid, { '③謎田': 'a', 'ゴミ行': 'skip' });
  assert.strictEqual(r.byGame['d_A'].byRid.a.length, 1);
  assert.deepStrictEqual(r.unmatched, []);
});
t('複数試合はgameIdごとに分割', () => {
  const r = D.resolveCsvRows([
    { date: '2026-07-01', opponent: 'A', mode: 'attack', player: '①関山', result: 'goal' },
    { date: '2026-07-05', opponent: 'B', mode: 'attack', player: '①関山', result: 'miss' }
  ], nameToRid, {});
  assert.strictEqual(Object.keys(r.byGame).length, 2);
});

t('複数の重複グループを同時検出', () => {
  const r2 = {
    a: { surname: '関山', enrollmentYear: 2026 }, b: { surname: '関山', enrollmentYear: 2026 },
    c: { surname: '小川', enrollmentYear: 2025 }, d: { surname: '小川', enrollmentYear: 2025 }
  };
  assert.strictEqual(D.findRosterDuplicates(r2).length, 2);
});
t('姓が空の行は重複グループにしない', () => {
  const r2 = { a: { surname: '', enrollmentYear: 0 }, b: { surname: ' ', enrollmentYear: 0 } };
  assert.deepStrictEqual(D.findRosterDuplicates(r2), []);
});
t('統合先が未連携で重複2行が別uid連携→conflict・moveUidなし', () => {
  const p = D.planMerge(group, { b: 'uid1', e: 'uid2' }, 'a');
  assert.strictEqual(p.conflict, true);
  assert.strictEqual(p.moveUid, null);
  assert.deepStrictEqual(p.unlinkIds.sort(), ['b', 'e']);
});
t('不正なchosenCanonicalIdは無視して自動選択', () => {
  const p = D.planMerge(group, { b: 'uid1' }, 'zzz-not-in-group');
  assert.strictEqual(p.canonicalId, 'b');
  assert.strictEqual(p.deleteIds.length, 2);
});
t('連携なしなら現役行を統合先に優先（引退行が先頭でも）', () => {
  const g2 = { key: 'k', entries: [{ id: 'r1', active: false }, { id: 'r2' }, { id: 'r3', active: false }] };
  assert.strictEqual(D.planMerge(g2, {}).canonicalId, 'r2');
});

console.log(`\n${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
