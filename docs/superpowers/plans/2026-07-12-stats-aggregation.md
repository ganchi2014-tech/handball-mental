# 試合成績のメンタル集約 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 名簿の重複を統合・再発防止し、過去試合CSVを正しく取り込み、コーチが全員の決定率等を一覧できるようにする（spec: `docs/superpowers/specs/2026-07-12-stats-aggregation-design.md`）。

**Architecture:** handball-mental は単一 `index.html`（React 18 CDN + Babel standalone 7.26.4 固定 + Firebase RTDB compat 10.13.2）。新しい純ロジックは新規 `lib/dedupe.js`（UMD、node でテスト可能）に置き、`index.html` からは `window.HMDedupe` で使う。UI 変更は `index.html` 内の既存コンポーネント（`RosterManagement` / `CsvImport` / `CoachDashboard` / `PlayerDetail`）を編集。Firebase ルールは `database.rules.json`。

**Tech Stack:** Vanilla JS (UMD) + node 組込み `assert`（新規テスト）/ React JSX in Babel（UI）/ Firebase RTDB ルール。

**前提知識（調査済みの現状）:**
- 名簿の正 = RTDB `/roster/{rosterId}`（push自動ID）。表示名は `rosterDisplayName()`（`computeGrade`で学年記号①②③＋姓）。コーチのみ書込可。
- `/rosterToUid/{rosterId} = mentalUid` が選手端末との連携。コーチも書込可（rules 55-60行）。
- 試合データは `users/{uid}/gameStats/{gameId}/{idx}`。集計は `aggregateGameStats()`（index.html 4362行付近）。
- **選手側の集約表示（マイ統計: 決定率・GKセーブ率・LAB指標タイル）と、コーチの個人詳細（PlayerDetail の試合統計）は実装済み。** 本計画では作らない。
- LAB 連携は `/labLinks/{mentalUid} = {labUid, rosterId}` ブリッジ＋ `storage.resolveLabUid()` / `getMyLabCards()` / `getMyLabNode()`（index.html 799-837行付近）。現行ルールではコーチは他選手の lab データを読めない。
- 既存 `CsvImport`（index.html 5304行付近）の欠陥: (1) 守備行（`mode==='defense'`、GKセーブ）が捨てられる (2) 学年記号ズレ（昨年のCSVの②が今年は③）で不一致 (3) 未一致名の手動対応付け不可 (4) 複数試合が混ざったCSVを1試合として誤保存 (5) 行単位 `set` で再取込時に古い行が残り得る。
- 重複の原因: `seedDefault()`（4947行付近）の複数回実行と `save()`（4962行付近）の重複チェックなし。
- デプロイ: GitHub Pages（`git push origin main`）＋ Firebase（`firebase deploy --only database` でルール、`--only hosting` で web.app）。プロジェクトは `.firebaserc` で `handball-mental`。
- **注意:** 以下の行番号は執筆時点。タスク実行で前後するので、コード断片で検索して位置を特定すること。
- **注意:** アプリは本番 RTDB に直結している。UI の手動確認は読み取り系に留め、書込系の確認はタスク9の受入手順（テスト選手を使う）でオーナーが行う。

---

### Task 1: `lib/dedupe.js` 純関数 + node テスト（TDD）

**Files:**
- Create: `lib/dedupe.js`
- Test: `tests/dedupe.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/dedupe.test.js` を新規作成（依存なし・node 組込み assert のみ）:

```js
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

console.log(`\n${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
```

- [ ] **Step 2: 失敗を確認**

Run: `node tests/dedupe.test.js`（作業ディレクトリ = リポジトリルート `handball-mental/`）
Expected: `Cannot find module '../lib/dedupe.js'` で異常終了。

- [ ] **Step 3: `lib/dedupe.js` を実装**

```js
// 名簿の重複検出・統合計画と CSV 取込解決の純関数群。
// ブラウザ(window.HMDedupe)と node(module.exports)の両方から使う。
// Firebase やDOMに触れない（テスト可能性のための制約）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HMDedupe = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 姓の正規化: NFKC（全半角統一）＋空白（全角含む）除去
  function normalizeSurname(s) {
    return String(s || '').normalize('NFKC').replace(/[\s　]+/g, '');
  }

  function dupKey(r) {
    return normalizeSurname(r && r.surname) + '|' + ((r && r.enrollmentYear) || 0);
  }

  // 同姓（正規化後）＋同入学年度のグループ（2件以上のみ）を返す。
  // 同姓でも入学年度が違えば正しい別人なのでグループにしない。
  function findRosterDuplicates(roster) {
    const groups = {};
    Object.entries(roster || {}).forEach(([id, r]) => {
      if (!r) return;
      const key = dupKey(r);
      (groups[key] = groups[key] || []).push({ id, ...r });
    });
    return Object.entries(groups)
      .filter(([, arr]) => arr.length > 1)
      .map(([key, entries]) => ({ key, entries }));
  }

  // 統合計画（実行はしない）。統合先が未指定なら「端末連携がちょうど1つならその行」を推す。
  // moveUid: 統合先が未連携で重複側にちょうど1連携 → そのuidを統合先へ移す
  // conflict: 統合先と重複側の両方に連携がある/重複側に2つ以上 → 連携を失う端末が出る
  function planMerge(group, rosterToUid, chosenCanonicalId) {
    const map = rosterToUid || {};
    const linked = group.entries.filter(e => map[e.id]);
    const canonicalId = chosenCanonicalId
      || (linked.length === 1 ? linked[0].id : group.entries[0].id);
    const deleteIds = group.entries.map(e => e.id).filter(id => id !== canonicalId);
    const unlinkIds = deleteIds.filter(id => map[id]);
    const canonicalLinked = !!map[canonicalId];
    const moveUid = (!canonicalLinked && unlinkIds.length === 1) ? map[unlinkIds[0]] : null;
    const conflict = (canonicalLinked && unlinkIds.length > 0) || unlinkIds.length > 1;
    return { canonicalId, deleteIds, unlinkIds, moveUid, conflict };
  }

  // analyzer CSV の試合ID（既存 CsvImport と同じ規則を維持: 日付_相手名の記号除去）
  function csvGameId(row) {
    const opp = String((row && row.opponent) || 'unknown')
      .replace(/[^a-zA-Z0-9一-龯ぁ-んァ-ヶ]/g, '');
    return ((row && row.date) || '') + '_' + opp;
  }

  // 名前 → rosterId。完全一致 → 学年記号(①②③)を外した正規化姓 の順に試す
  function lookupRid(nameToRid, rawName) {
    const name = String(rawName || '').trim();
    if (nameToRid[name]) return nameToRid[name];
    const bare = normalizeSurname(name.replace(/^[①②③]/, ''));
    return nameToRid[bare] || null;
  }

  // CSVパース済み行を { 試合ID → rosterId → 行[] } に解決する。
  // 攻撃行は player 列、守備行(mode==='defense')は gk 列で当該GKに配信（セーブ率用）。
  // manualMap: { 名前: rosterId | 'skip' }（未一致名のコーチ手動指定）
  function resolveCsvRows(rows, nameToRid, manualMap) {
    const byGame = {};
    const unmatched = new Set();
    let matchedRows = 0;
    (rows || []).forEach(row => {
      const isDefense = row.mode === 'defense';
      const name = isDefense ? (row.gk || '') : (row.player || '');
      if (!name) return; // 選手未指定の行は対象外（従来どおり）
      const manual = manualMap && manualMap[name];
      if (manual === 'skip') return;
      const rid = manual || lookupRid(nameToRid, name);
      if (!rid) { unmatched.add(name); return; }
      const gameId = csvGameId(row);
      const g = (byGame[gameId] = byGame[gameId] || { byRid: {} });
      (g.byRid[rid] = g.byRid[rid] || []).push(row);
      matchedRows++;
    });
    return { byGame, unmatched: Array.from(unmatched), matchedRows };
  }

  return { normalizeSurname, dupKey, findRosterDuplicates, planMerge, csvGameId, lookupRid, resolveCsvRows };
}));
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node tests/dedupe.test.js`
Expected: すべて `PASS`、末尾 `14 tests passed`、exit code 0。

- [ ] **Step 5: Commit**

```bash
git add lib/dedupe.js tests/dedupe.test.js
git commit -m "feat: 名簿重複検出・統合計画・CSV解決の純関数(lib/dedupe.js)+nodeテスト"
```

---

### Task 2: `index.html` への組込みと Service Worker 更新

**Files:**
- Modify: `index.html`（`<head>` の firebase スクリプト群の直後、30行付近）
- Modify: `sw.js`（`CACHE_NAME` と `ASSETS`）

- [ ] **Step 1: `index.html` にスクリプトタグを追加**

`<script src="https://www.gstatic.com/firebasejs/10.13.2/firebase-database-compat.js"></script>` の直後に追加:

```html
  <script src="./lib/dedupe.js"></script>
```

- [ ] **Step 2: `sw.js` を更新（プリキャッシュ追加＋バージョン繰上げ）**

`const CACHE_NAME = 'handball-mental-v5';` を書き換え、既存のコメント様式に合わせて1行追記:

```js
// v6: lib/dedupe.js（名簿統合・CSV取込の純関数）をプリキャッシュに追加
const CACHE_NAME = 'handball-mental-v6';
```

`ASSETS` 配列の `'./manifest.json',` の直後に追加:

```js
  './lib/dedupe.js',
```

- [ ] **Step 3: 構文スモーク（ローカル静的サーバで白画面でないこと）**

Run: `npx -y serve -l 8123 .`（リポジトリルート。止めるときは Ctrl+C）
ブラウザで `http://localhost:8123` を開き、ログイン画面（HANDBALL MENTAL のタイトルと名簿リスト）が表示され、DevTools コンソールに赤エラーがないこと。`window.HMDedupe` がコンソールで object を返すこと。
※本番 RTDB に読み取り接続されるが、ログインしなければ書込は起きない。

- [ ] **Step 4: Commit**

```bash
git add index.html sw.js
git commit -m "feat: lib/dedupe.js を index.html と SW プリキャッシュ(v6)に組込み"
```

---

### Task 3: Firebase ルール変更（コーチの LAB 読取＋labLinks 付替え許可）

**Files:**
- Modify: `database.rules.json`

- [ ] **Step 1: `lab` の read にコーチを追加**

変更前（67-72行）:
```json
    "lab": {
      "$uid": {
        ".read": "auth != null && ($uid === auth.uid || root.child('labLinks').child(auth.uid).child('labUid').val() === $uid)",
```
変更後:
```json
    "lab": {
      "$uid": {
        ".read": "auth != null && ($uid === auth.uid || root.child('labLinks').child(auth.uid).child('labUid').val() === $uid || root.child('coaches').child(auth.uid).exists())",
```
（`.write` は変更しない — LAB 本人のみのまま）

- [ ] **Step 2: `labLinks` の read にコーチを追加、write に「labUid を変えない更新のみ」のコーチ条項を追加**

変更前（74-79行）:
```json
    "labLinks": {
      "$mentalUid": {
        ".read": "auth != null && (auth.uid === $mentalUid || data.child('labUid').val() === auth.uid)",
        ".write": "auth != null && ((newData.exists() && newData.child('labUid').val() === auth.uid && newData.child('rosterId').isString() && (!data.exists() || data.child('labUid').val() === auth.uid)) || (!newData.exists() && data.exists() && (data.child('labUid').val() === auth.uid || auth.uid === $mentalUid)))",
        ".validate": "!newData.exists() || newData.hasChildren(['labUid', 'rosterId'])"
      }
    },
```
変更後:
```json
    "labLinks": {
      "$mentalUid": {
        ".read": "auth != null && (auth.uid === $mentalUid || data.child('labUid').val() === auth.uid || root.child('coaches').child(auth.uid).exists())",
        ".write": "auth != null && ((newData.exists() && newData.child('labUid').val() === auth.uid && newData.child('rosterId').isString() && (!data.exists() || data.child('labUid').val() === auth.uid)) || (!newData.exists() && data.exists() && (data.child('labUid').val() === auth.uid || auth.uid === $mentalUid)) || (root.child('coaches').child(auth.uid).exists() && data.exists() && newData.exists() && newData.child('labUid').val() === data.child('labUid').val() && newData.child('rosterId').isString()))",
        ".validate": "!newData.exists() || newData.hasChildren(['labUid', 'rosterId'])"
      }
    },
```
意図: コーチは既存リンクの `rosterId` の付替えだけ可能（`labUid` は改変不可・新規作成/削除は不可）。名簿統合（Task 5）が使う。LAB 側の鉄則（LAB から `/rosterToUid` に書かない等）には触れない。

- [ ] **Step 3: JSON 構文チェック**

Run: `node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: ルールをデプロイ**

Run: `firebase deploy --only database`
Expected: `Deploy complete!`。失敗（未ログイン等）の場合は中断してオーナーに報告（`firebase login` が必要）。

- [ ] **Step 5: Commit**

```bash
git add database.rules.json
git commit -m "feat(rules): コーチのLAB読取と labLinks.rosterId 付替えを許可（labUid改変・新規作成は不可のまま）"
```

---

### Task 4: seedDefault 差分投入＋手動追加の重複警告（再発防止）

**Files:**
- Modify: `index.html` — `RosterManagement` 内 `seedDefault`（4947行付近）と `save`（4962行付近）

- [ ] **Step 1: `seedDefault` を差分投入に書き換え**

変更前:
```js
      const seedDefault = async () => {
        const defaults = makeDefaultRosterEntries();
        if (Object.keys(roster).length > 0) {
          if (!confirm(`既に ${Object.keys(roster).length} 名登録されています。デフォルト${defaults.length}名（1・2年）を追加で投入しますか？`)) return;
        } else {
          if (!confirm(`analyzer デフォルトの${defaults.length}名（1・2年）を投入しますか？`)) return;
        }
        const fbDB = window.fbDB;
        for (const entry of defaults) {
          const newId = fbDB.ref('roster').push().key;
          await storage.upsertRoster(newId, entry);
        }
        showToast(`${defaults.length}名を投入しました`);
      };
```
変更後:
```js
      const seedDefault = async () => {
        const defaults = makeDefaultRosterEntries();
        // 既存（同姓＋同入学年度）はスキップして未登録分だけ投入 — 二度押しで複製しない
        const existing = new Set(Object.values(roster || {}).map(r => HMDedupe.dupKey(r)));
        const missing = defaults.filter(d => !existing.has(HMDedupe.dupKey(d)));
        if (missing.length === 0) { showToast('デフォルト名簿は投入済みです（追加なし）'); return; }
        if (!confirm(`デフォルト${defaults.length}名のうち未登録の${missing.length}名を投入しますか？\n（登録済みの${defaults.length - missing.length}名はスキップ）`)) return;
        const fbDB = window.fbDB;
        for (const entry of missing) {
          const newId = fbDB.ref('roster').push().key;
          await storage.upsertRoster(newId, entry);
        }
        showToast(`${missing.length}名を投入しました`);
      };
```

- [ ] **Step 2: `save` に新規追加時の重複警告を入れる**

変更前:
```js
      const save = async (data) => {
        const fbDB = window.fbDB;
        const id = editing.id || fbDB.ref('roster').push().key;
```
変更後:
```js
      const save = async (data) => {
        const fbDB = window.fbDB;
        // 新規追加のみ: 同姓＋同入学年度の既存行があれば警告（意図的な同姓別人の追加は続行可）
        if (!editing.id) {
          const key = HMDedupe.dupKey({ surname: data.surname, enrollmentYear: Number(data.enrollmentYear) });
          const dup = Object.values(roster || {}).find(r => r && HMDedupe.dupKey(r) === key);
          if (dup && !confirm(`同じ姓・同じ入学年度の「${rosterDisplayName(dup)}」が既に登録されています。\n同一人物なら追加せず、既存の行を使ってください。\n\n別人として追加しますか？`)) return;
        }
        const id = editing.id || fbDB.ref('roster').push().key;
```

- [ ] **Step 3: スモーク確認**

Task 2 Step 3 と同じローカルサーバで白画面・コンソールエラーがないこと（コーチ画面の操作確認はタスク9でオーナーが実施）。

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "fix: デフォルト名簿投入を差分のみに・手動追加に同姓同年度の重複警告（重複の再発防止）"
```

---

### Task 5: 名簿の重複チェック＆統合 UI

**Files:**
- Modify: `index.html` — `RosterManagement`（4921行付近）に重複カードと実行関数を追加、`RosterManagement` 関数の直前に `DupGroup` コンポーネントを新設

- [ ] **Step 1: `DupGroup` コンポーネントを追加**

`// ====== Roster Management (顧問用) ======` コメントの直前に挿入:

```jsx
    // ====== 名簿の重複グループ（統合先の選択と実行ボタン） ======
    function DupGroup({ group, rosterToUid, onMerge }) {
      const suggested = HMDedupe.planMerge(group, rosterToUid).canonicalId;
      const [canonicalId, setCanonicalId] = useState(suggested);
      return (
        <div style={{marginTop:12, paddingTop:12, borderTop:'1px solid rgba(255,255,255,0.08)'}}>
          {group.entries.map(e => (
            <label key={e.id} style={{display:'flex', alignItems:'center', gap:8, padding:'4px 0', cursor:'pointer'}}>
              <input type="radio" name={'dup-' + group.key} checked={canonicalId === e.id} onChange={() => setCanonicalId(e.id)} />
              <span>
                {rosterDisplayName(e)}（{e.enrollmentYear}年入学{e.active === false ? '・引退' : ''}）
                {rosterToUid && rosterToUid[e.id]
                  ? <span style={{color:'var(--accent)'}}> ✓ 端末連携あり</span>
                  : <span className="text-muted"> 連携なし</span>}
              </span>
            </label>
          ))}
          <button className="btn-ghost mt-16" onClick={() => onMerge(group, canonicalId)}>
            選択した行に統合（他 {group.entries.length - 1} 行を削除）
          </button>
        </div>
      );
    }
```

- [ ] **Step 2: `RosterManagement` に重複検出と統合実行を追加**

`const linkedCount = ...` 行（4945行付近）の直後に追加:

```jsx
      // 重複（同姓＋同入学年度）の検出と統合
      const dupGroups = useMemo(() => HMDedupe.findRosterDuplicates(roster), [roster]);

      const executeMerge = async (group, canonicalId) => {
        const plan = HMDedupe.planMerge(group, rosterToUid, canonicalId);
        const canonical = group.entries.find(e => e.id === plan.canonicalId);
        const lines = [`「${rosterDisplayName(canonical)}」に統合します。`, `削除される重複行: ${plan.deleteIds.length}件`];
        if (plan.moveUid) lines.push('端末連携を統合先に引き継ぎます。');
        if (plan.conflict) lines.push('⚠ 複数の行が別々の端末に連携済みです。統合先以外の連携は解除され、その端末は次回ログインで名簿から選び直しになります（配信済み試合データは「クラウド試合取込」の再配信で復元できます）。');
        if (!confirm(lines.join('\n'))) return;
        try {
          if (plan.moveUid) await storage.linkRosterToUid(plan.canonicalId, plan.moveUid);
          for (const id of plan.unlinkIds) {
            // uid を引き継ぐ場合は LAB ブリッジ(labLinks)の rosterId も統合先へ付替え（失敗しても続行）
            const uid = rosterToUid[id];
            if (uid && plan.moveUid === uid) {
              try {
                const snap = await window.fbDB.ref('labLinks/' + uid).get();
                const link = snap.val();
                if (link && link.rosterId === id) {
                  await window.fbDB.ref('labLinks/' + uid + '/rosterId').set(plan.canonicalId);
                }
              } catch (e) { console.warn('[merge labLinks]', e); }
            }
            await storage.unlinkRoster(id);
          }
          for (const id of plan.deleteIds) await storage.deleteRoster(id);
          showToast(`統合しました（${plan.deleteIds.length}行を削除）`);
        } catch (e) {
          console.error('[merge]', e);
          alert('統合中にエラー: ' + e.message + '\n途中まで実行された可能性があります。重複チェックの表示を確認してください。');
        }
      };
```

- [ ] **Step 3: 重複カードを表示に追加**

`<div className="section-h">名簿管理 ...` の行（5010行付近）の直後に挿入:

```jsx
          {dupGroups.length > 0 && (
            <div className="card" style={{borderLeft:'3px solid var(--warning)', marginBottom:16}}>
              <div className="card-title">⚠ 名簿の重複 {dupGroups.length}組</div>
              <div className="card-subtitle">同じ姓・同じ入学年度の行が複数あります。放置すると試合データが正しく配信されません（同姓でも学年が違うのは別人なのでここには出ません）。</div>
              {dupGroups.map(group => (
                <DupGroup key={group.key} group={group} rosterToUid={rosterToUid} onMerge={executeMerge} />
              ))}
            </div>
          )}
```

- [ ] **Step 4: スモーク確認**

ローカルサーバで白画面・コンソールエラーがないこと。

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: 名簿の重複チェック＆統合ツール（連携uid引継ぎ・labLinks付替え・確認2段階）"
```

---

### Task 6: CsvImport 刷新（守備行・学年ズレ・手動対応付け・複数試合・bulk置換）

**Files:**
- Modify: `index.html` — `CsvImport` コンポーネント全体を置換（5304行付近 `// ====== CSV Import (analyzer出力CSV取込) ======` から `parseCsvLine` の直前まで）

- [ ] **Step 1: `CsvImport` を以下で置き換える**

`parseCsvLine`（簡易CSVパーサ）は既存のまま残す。

```jsx
    // ====== CSV Import (analyzer出力CSV取込) ======
    // 解決ロジックは lib/dedupe.js（resolveCsvRows）。守備行はGKに配信・複数試合対応・
    // 未一致名はコーチが手動対応付け（全て解決するまで確定ボタン無効 = 黙って捨てない）
    function CsvImport({ roster, rosterToUid, showToast, onBack }) {
      const [rows, setRows] = useState(null);          // パース済み全行
      const [manualMap, setManualMap] = useState({});  // {名前: rosterId|'skip'}
      const [busy, setBusy] = useState(false);

      // 表示名＋（チーム内で一意な正規化姓）→ rosterId。引退選手も含める（過去CSVのため）
      const nameToRid = useMemo(() => {
        const map = {};
        const bareCount = {};
        Object.entries(roster || {}).forEach(([rid, r]) => {
          if (!r) return;
          map[rosterDisplayName(r)] = rid;
          const bare = HMDedupe.normalizeSurname(r.surname);
          bareCount[bare] = (bareCount[bare] || 0) + 1;
        });
        Object.entries(roster || {}).forEach(([rid, r]) => {
          if (!r) return;
          const bare = HMDedupe.normalizeSurname(r.surname);
          if (bareCount[bare] === 1) map[bare] = rid; // 姓が一意なときだけ姓でも引ける
        });
        return map;
      }, [roster]);

      const resolution = useMemo(
        () => rows ? HMDedupe.resolveCsvRows(rows, nameToRid, manualMap) : null,
        [rows, nameToRid, manualMap]);

      const onFile = async (file) => {
        if (!file) return;
        const text = await file.text();
        const clean = text.replace(/^﻿/, '');
        const lines = clean.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) { alert('データ行がありません'); return; }
        const headers = parseCsvLine(lines[0]);
        if (!headers.includes('player') || !headers.includes('result')) {
          alert('analyzer出力CSVではないようです（player / result 列が見つかりません）');
          return;
        }
        setRows(lines.slice(1).map(l => {
          const cells = parseCsvLine(l);
          const row = {};
          headers.forEach((h, i) => row[h] = cells[i] || '');
          return row;
        }));
        setManualMap({});
      };

      const commit = async () => {
        if (!resolution) return;
        const games = Object.entries(resolution.byGame);
        if (games.length === 0) return;
        if (!confirm(`${games.length}試合・${resolution.matchedRows}行を配信します。\n同じ試合ID（日付_相手）の既存データは上書きされます。よろしいですか？`)) return;
        setBusy(true);
        try {
          let savedPlayers = 0;
          const skippedNames = new Set();
          for (const [gameId, g] of games) {
            for (const [rid, ridRows] of Object.entries(g.byRid)) {
              const uid = (rosterToUid || {})[rid];
              if (!uid) {
                const r = roster[rid];
                skippedNames.add(r ? rosterDisplayName(r) : rid);
                continue;
              }
              const rowsObj = {};
              ridRows.forEach((row, i) => { rowsObj[i] = row; });
              await storage.saveGameStatsBulk(uid, gameId, rowsObj); // set() = 同一試合はまるごと置換
              savedPlayers++;
            }
          }
          let msg = `✅ ${games.length}試合を配信（延べ${savedPlayers}名分）`;
          if (skippedNames.size > 0) msg += `\n⚠ mental未連携でスキップ: ${Array.from(skippedNames).join('・')}\n（選手がログインで連携したあと、同じCSVを再取込してください）`;
          alert(msg);
          setRows(null); setManualMap({});
        } catch (e) {
          console.error(e);
          alert('保存中にエラー: ' + e.message);
        } finally {
          setBusy(false);
        }
      };

      const unresolvedCount = resolution ? resolution.unmatched.filter(n => !manualMap[n]).length : 0;

      return (
        <>
          <button className="btn-ghost mb-16" onClick={onBack}>← 顧問Dashboardに戻る</button>
          <div className="section-h">CSV取込（analyzer出力）</div>

          {!rows && (
            <>
              <div className="card">
                <div className="card-title">使い方</div>
                <div className="card-subtitle" style={{lineHeight:1.7}}>
                  1. handball-analyzer で試合データをCSVエクスポート<br/>
                  2. このページでCSVファイルを選択（複数試合が混ざったCSVもOK）<br/>
                  3. プレビューで紐付けを確認 → 確定<br/>
                  4. 各選手のマイ統計に配信（GKのセーブ率も入ります）
                </div>
              </div>
              <div className="card mt-16">
                <label className="btn" style={{display:'block', textAlign:'center'}}>
                  📁 CSVファイルを選択
                  <input type="file" accept=".csv,text/csv" style={{display:'none'}}
                    onChange={e => onFile(e.target.files[0])} />
                </label>
              </div>
            </>
          )}

          {resolution && (
            <>
              <div className="card">
                <div className="card-title">プレビュー</div>
                <div className="summary-stats" style={{marginTop:12}}>
                  <div className="stat-card"><div className="num">{Object.keys(resolution.byGame).length}</div><div className="label">試合</div></div>
                  <div className="stat-card"><div className="num" style={{color:'var(--success)'}}>{resolution.matchedRows}</div><div className="label">紐付OK行</div></div>
                  <div className="stat-card"><div className="num" style={{color: resolution.unmatched.length ? 'var(--warning)' : 'var(--text-3)'}}>{resolution.unmatched.length}</div><div className="label">要対応の名前</div></div>
                </div>
              </div>

              {resolution.unmatched.length > 0 && (
                <div className="card mt-16" style={{borderLeft:'3px solid var(--warning)'}}>
                  <div className="card-title">⚠ 名簿と一致しない名前</div>
                  <div className="card-subtitle">名簿の選手を指定するか「取り込まない」を選んでください（全部決めるまで確定できません）。</div>
                  {resolution.unmatched.map(n => (
                    <div key={n} className="stat-row">
                      <span className="label">{n}</span>
                      <select value={manualMap[n] || ''} onChange={e => setManualMap({ ...manualMap, [n]: e.target.value })}>
                        <option value="">（未選択）</option>
                        <option value="skip">取り込まない</option>
                        {Object.entries(roster || {}).map(([rid, r]) => (
                          <option key={rid} value={rid}>{rosterDisplayName(r)}{r.active === false ? '（引退）' : ''}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}

              <div className="section-h mt-16">試合別の配信先</div>
              {Object.entries(resolution.byGame).map(([gameId, g]) => (
                <div key={gameId} className="card" style={{marginBottom:12}}>
                  <div className="card-title">{gameId}</div>
                  <div className="card-subtitle" style={{lineHeight:1.8}}>
                    {Object.entries(g.byRid).map(([rid, ridRows]) => {
                      const r = roster[rid];
                      const linked = (rosterToUid || {})[rid];
                      return (
                        <span key={rid} style={{marginRight:10, color: linked ? undefined : 'var(--warning)'}}>
                          {r ? rosterDisplayName(r) : rid} {ridRows.length}行{linked ? '' : '（未連携→スキップ）'}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div style={{display:'flex', gap:8, marginTop:16}}>
                <button className="btn btn-secondary" style={{flex:1}} onClick={() => { setRows(null); setManualMap({}); }}>キャンセル</button>
                <button className="btn" style={{flex:1}} disabled={busy || resolution.matchedRows === 0 || unresolvedCount > 0} onClick={commit}>
                  {busy ? '保存中...' : (unresolvedCount > 0 ? `未対応の名前が${unresolvedCount}件` : '確定して配信')}
                </button>
              </div>
            </>
          )}
        </>
      );
    }
```

- [ ] **Step 2: スモーク確認**

ローカルサーバで白画面・コンソールエラーがないこと。

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: CSV取込を刷新 — GK守備行配信・学年記号ズレ吸収・未一致名の手動対応付け・複数試合分割・同一試合は置換"
```

---

### Task 7: コーチ Dashboard にチーム成績一覧カード

**Files:**
- Modify: `index.html` — `CoachDashboard`（3435行付近）。「チーム全体」カード（`<div className="card-title">チーム全体</div>` を含むカード）の閉じタグ直後に追加。あわせて LAB 読み%のオンデマンド読込を追加。

- [ ] **Step 1: `CoachDashboard` 冒頭（`const [tab, setTab] = ...` の直後）に state と読込関数を追加**

```jsx
      const [teamLab, setTeamLab] = useState(null); // null | 'loading' | {uid: pct|null}

      // LAB読み的中率をオンデマンドで全員分読む（Task 3 のルールでコーチ読取可）
      const loadTeamLab = async () => {
        setTeamLab('loading');
        const out = {};
        for (const p of players) {
          try {
            const cards = await storage.getMyLabCards(p.uid);
            let n = 0, h = 0;
            cards.forEach(c => {
              const ys = Array.isArray(c && c.yomi) ? c.yomi : Object.values((c && c.yomi) || {});
              ys.forEach(y => { if (y && (y.hit === true || y.hit === false)) { n++; if (y.hit === true) h++; } });
            });
            out[p.uid] = n > 0 ? Math.round(h / n * 100) : null;
          } catch (e) { console.debug('[team lab]', p.uid, e); out[p.uid] = null; }
        }
        setTeamLab(out);
      };
```

- [ ] **Step 2: チーム成績カードを「チーム全体」カードの直後に追加**

```jsx
          {/* チーム成績一覧（試合データ累計。タップで個人詳細へ） */}
          {players.some(p => p.statsGames && p.statsGames.length > 0) && (
            <div className="card mt-16">
              <div className="card-title">📊 チーム成績（累計）</div>
              <div className="card-subtitle">決定率 = ゴール÷シュート（TO除く）。GKはセーブ率。タップで個人詳細。</div>
              {players
                .filter(p => p.statsGames && p.statsGames.length > 0)
                .sort((a, b) => b.statsTotal.goals - a.statsTotal.goals)
                .map(p => (
                  <div key={p.uid} className="stat-row" onClick={() => setSelected(p)} style={{cursor:'pointer'}}>
                    <span className="label">{p.profile.name}</span>
                    <span className="value">
                      {p.statsTotal.faced > 0
                        ? `🧤 ${p.statsTotal.saves}SV/枠内${p.statsTotal.faced} (${p.statsTotal.saveRate}%)`
                        : `${p.statsTotal.goals}G/${p.statsTotal.shots}S (${p.statsTotal.goalRate}%)`}
                      {p.statsTotal.turnovers > 0 ? ` TO${p.statsTotal.turnovers}` : ''}
                      {teamLab && teamLab !== 'loading' && teamLab[p.uid] != null ? ` ・読み${teamLab[p.uid]}%` : ''}
                    </span>
                  </div>
                ))}
              <button className="btn-ghost mt-16" style={{width:'100%'}} disabled={teamLab === 'loading'} onClick={loadTeamLab}>
                {teamLab === 'loading' ? '読込中...' : (teamLab ? '🔄 LAB読み的中率を再読込' : '🧪 LAB読み的中率も表示')}
              </button>
            </div>
          )}
```

- [ ] **Step 3: スモーク確認 → Commit**

```bash
git add index.html
git commit -m "feat: 顧問DashboardにチームG/S/決定率・セーブ率一覧＋LAB読み%オンデマンド表示"
```

---

### Task 8: PlayerDetail に LAB 指標カード

**Files:**
- Modify: `index.html` — `PlayerDetail`（3734行付近）。「試合統計（analyzer）」セクション（`{p.statsGames && p.statsGames.length > 0 && (` ブロック、3788行付近）の直後に追加。

- [ ] **Step 1: `PlayerDetail` 冒頭（既存の useState 群の並び）に追加**

```jsx
      const [lab, setLab] = useState(null); // null | 'loading' | {yomi, gkPred, pv}
      const loadLab = async () => {
        setLab('loading');
        try {
          const [cards, gkRecs, pvRecs] = await Promise.all([
            storage.getMyLabCards(p.uid),
            storage.getMyLabNode(p.uid, 'gkPredictions'),
            storage.getMyLabNode(p.uid, 'pvRecords')
          ]);
          let yn = 0, yh = 0;
          cards.forEach(c => {
            const ys = Array.isArray(c && c.yomi) ? c.yomi : Object.values((c && c.yomi) || {});
            ys.forEach(y => { if (y && (y.hit === true || y.hit === false)) { yn++; if (y.hit === true) yh++; } });
          });
          let gn = 0, gh = 0;
          gkRecs.forEach(r => { if (r && (r.hit === true || r.hit === false)) { gn++; if (r.hit === true) gh++; } });
          setLab({
            yomi: yn > 0 ? { n: yn, h: yh, pct: Math.round(yh / yn * 100) } : null,
            gkPred: gn > 0 ? { n: gn, h: gh, pct: Math.round(gh / gn * 100) } : null,
            pv: pvRecs.filter(Boolean).length
          });
        } catch (e) { console.debug('[coach lab detail]', e); setLab({ yomi: null, gkPred: null, pv: 0 }); }
      };
```

※ `PlayerDetail` 内で選手オブジェクトが `p` 以外の変数名なら合わせること（`function PlayerDetail({ player, ... })` の場合は冒頭に `const p = player;` が既にあるか確認して読み替える）。

- [ ] **Step 2: LAB カードを試合統計セクションの直後に追加**

```jsx
          {/* LAB指標（オンデマンド読込。ルールでコーチ読取可） */}
          <div className="card mt-16">
            <div className="card-title">🧪 LAB指標</div>
            {!lab && <button className="btn-ghost mt-16" style={{width:'100%'}} onClick={loadLab}>読み・GK予測・PV認知を読み込む</button>}
            {lab === 'loading' && <div className="card-subtitle">読込中...</div>}
            {lab && lab !== 'loading' && (
              <>
                {lab.yomi && <div className="stat-row"><span className="label">🔮 読み的中率</span><span className="value">{lab.yomi.pct}%（{lab.yomi.h}/{lab.yomi.n}件）</span></div>}
                {lab.gkPred && <div className="stat-row"><span className="label">🧤 GK予測的中率</span><span className="value">{lab.gkPred.pct}%（{lab.gkPred.h}/{lab.gkPred.n}本）</span></div>}
                {lab.pv > 0 && <div className="stat-row"><span className="label">🎯 PV認知記録</span><span className="value">{lab.pv} 件</span></div>}
                {!lab.yomi && !lab.gkPred && lab.pv === 0 && <div className="card-subtitle">LABの記録がまだありません（LAB未接続の選手は出ません）</div>}
              </>
            )}
          </div>
```

- [ ] **Step 3: スモーク確認 → Commit**

```bash
git add index.html
git commit -m "feat: 顧問の個人詳細にLAB指標カード（読み・GK予測・PV認知をオンデマンド読込）"
```

---

### Task 9: デプロイとオーナー受入手順

- [ ] **Step 1: 全テスト再実行**

Run: `node tests/dedupe.test.js` → 全PASS。
Run: `node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8')); console.log('OK')"` → OK。
ローカルサーバでログイン画面表示・コンソールエラーなしを最終確認。

- [ ] **Step 2: デプロイ**

```bash
git push origin main
firebase deploy --only hosting
```
（database ルールは Task 3 でデプロイ済み。未実施ならここで `--only database` も）

- [ ] **Step 3: オーナー受入チェックリストを提示（チャットで案内）**

オーナー（コーチ端末）にお願いする確認手順:
1. **重複統合E2E**: 名簿管理 →「＋選手を追加」で姓「テスト」・同じ入学年度を**2回**追加（2回目に警告が出ること）→ 重複カードが出る → 統合 → 1行になる → テスト行を削除。
2. **seedDefault**: 「デフォルト名簿を投入」を押し「投入済みです（追加なし）」になること（実名簿が揃っている前提）。
3. **本物の重複統合**: 実際の重複組で、端末連携ありの行が統合先に推奨されることを確認して統合。
4. **CSV取込**: 過去試合CSVを1件取込 → プレビューでGK行・未一致名の対応付けを確認 → 確定 → 選手のマイ統計とGKのセーブ率に反映。
5. **チーム成績カード**と**個人詳細のLAB指標**が表示されること。

---

### Task 10: 生徒向け・連携版アナライザー切替案内（運用）

- [ ] **Step 1: 案内文を作成しチャットで納品**（コードなし）

含める内容: 新URL（`https://ganchi2014-tech.github.io/handball-mental/handball-analyzer/`、mental が web.app 運用ならその配下）、変わる点（名簿が自動共有・「☁ メンタルアプリに送信」でCSV提出が不要になる）、変わらない点（記録操作は同じ）、切替日、旧単体版のCSVは顧問がまとめて取込済みであること。

---

### Task 11: 顧問PIN — ルール・ハッシュ・storageヘルパ

（追加要求 2026-07-12: spec `docs/superpowers/specs/2026-07-12-coach-pin-design.md`。個人別6桁PINで
新端末の顧問を自己承認できるようにする。PIN検証はルール側。）

**Files:**
- Modify: `database.rules.json`
- Modify: `index.html`（`verifyPin` の直後にハッシュ関数、`subscribeStaff` ブロックの直後に storage ヘルパ）

- [ ] **Step 1: `database.rules.json` — `coaches` ノードを置換**

変更前:
```json
    "coaches": {
      ".read": "auth != null",
      ".write": false
    },
```
変更後:
```json
    "coaches": {
      ".read": "auth != null",
      ".write": false,
      "$uid": {
        ".write": "auth != null && ((auth.uid === $uid && newData.isString() && newData.val() === root.child('coachClaims').child($uid).child('coachId').val()) || (root.child('coaches').child(auth.uid).exists() && !newData.exists()))"
      }
    },
```
意図: 本人は「自分のclaimと同じcoachId値」のみ書ける（claimはPIN一致時しか作れない）。
顧問は任意エントリの削除のみ可（端末整理）。追加の偽造は不可。Console手動の `true` は併存。

- [ ] **Step 2: `database.rules.json` — `staff` ノードの直後に3ノード追加**

```json
    "coachNames": {
      ".read": "auth != null",
      ".write": "auth != null && root.child('coaches').child(auth.uid).exists()"
    },
    "coachPins": {
      ".write": "auth != null && root.child('coaches').child(auth.uid).exists()"
    },
    "coachClaims": {
      "$uid": {
        ".write": "auth != null && (auth.uid === $uid || (root.child('coaches').child(auth.uid).exists() && !newData.exists()))",
        ".validate": "newData.child('coachId').isString() && newData.child('pinHash').isString() && newData.child('pinHash').val() === root.child('coachPins').child(newData.child('coachId').val()).val()"
      }
    },
```
※ `coachPins` に `.read` を書かない＝ルート `false` を継承（読取不可）。
※ `.validate` の `pinHash.isString()` は null===null 素通り防止のため必須。

- [ ] **Step 3: JSON構文チェック**

`node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8')); console.log('OK')"` → OK

- [ ] **Step 4: `index.html` — `verifyPin` 関数の閉じ`}`の直後（`// ====== Helpers ======` の前）に追加**

```js
    // 顧問PIN（6桁・端末間共通）: 端末間で同一ハッシュが必要なため固定salt（形式 'c1:hex'）。
    // 正誤判定はFirebaseルール側（coachClaims の .validate）。coachPins は読み取り不可のため
    // オフライン総当たりはできない
    async function hashCoachPin(pin) {
      const data = new TextEncoder().encode('coachpin|' + String(pin) + '|handball-mental');
      const digest = await crypto.subtle.digest('SHA-256', data);
      return 'c1:' + Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
```

- [ ] **Step 5: `index.html` — storage の `subscribeStaff` ヘルパの閉じ `},` の直後に追加**

```js
      // ----- 顧問ディレクトリ（PINログイン用。coachPins の正誤はルールが判定） -----
      subscribeCoachNames: (callback) => {
        if (!fbDB) return () => {};
        const ref = fbDB.ref('coachNames');
        const handler = ref.on('value', (snap) => callback(snap.val() || {}), () => callback({}));
        return () => ref.off('value', handler);
      },
      upsertCoachEntry: async (coachId, name, pinHash) => {
        if (!fbDB || !coachId || !name) return;
        await fbDB.ref('coachNames/' + coachId).set(name);
        if (pinHash) await fbDB.ref('coachPins/' + coachId).set(pinHash);
      },
      removeCoachEntry: async (coachId) => {
        if (!fbDB || !coachId) return;
        await fbDB.ref('coachPins/' + coachId).remove();
        await fbDB.ref('coachNames/' + coachId).remove();
      },
      // 新端末の顧問自己承認。PIN不一致なら1つ目の set がルールで拒否される
      claimCoach: async (authUid, coachId, pinHash) => {
        if (!fbDB || !authUid || !coachId) throw new Error('not ready');
        await fbDB.ref('coachClaims/' + authUid).set({ coachId, pinHash, at: firebase.database.ServerValue.TIMESTAMP });
        await fbDB.ref('coaches/' + authUid).set(coachId);
      },
      removeCoachDevice: async (targetUid) => {
        if (!fbDB || !targetUid) return;
        await fbDB.ref('coaches/' + targetUid).remove();
        await fbDB.ref('coachClaims/' + targetUid).remove();
      },
```

- [ ] **Step 6: 検証 → Commit**

`node tests/dedupe.test.js`（19 PASS）＋ JSON構文チェックOK。デプロイはしない。
```bash
git add database.rules.json index.html
git commit -m "feat: 顧問PIN基盤 — coachNames/coachPins/coachClaimsルールとhashCoachPin・storageヘルパ"
```

---

### Task 12: 顧問リスト管理画面（CoachDirectory）

**Files:**
- Modify: `index.html` — `// ====== 顧問承認待ち画面 ======` コメントの直前に `CoachDirectory` コンポーネントを新設。`CoachDashboard` にタブ追加（signature に `coaches` を追加し、呼出し側にも `coaches={coaches}` を渡す）。

- [ ] **Step 1: `CoachDirectory` コンポーネントを追加**（`// ====== 顧問承認待ち画面 ======` の直前）

```jsx
    // ====== 顧問リスト管理（PINログイン用ディレクトリ） ======
    function CoachDirectory({ coaches, myUid, showToast, onBack }) {
      const [names, setNames] = useState({});
      const [name, setName] = useState('');
      const [dirPin, setDirPin] = useState('');
      const [editingId, setEditingId] = useState(null); // PIN変更対象の coachId
      const [busy, setBusy] = useState(false);
      useEffect(() => storage.subscribeCoachNames(setNames), []);

      const save = async () => {
        if (!name.trim()) { alert('名前を入力してください'); return; }
        if (!/^\d{6}$/.test(dirPin)) { alert('顧問PINは6桁の数字で設定してください'); return; }
        setBusy(true);
        try {
          const id = editingId || window.fbDB.ref('coachNames').push().key;
          await storage.upsertCoachEntry(id, name.trim(), await hashCoachPin(dirPin));
          setName(''); setDirPin(''); setEditingId(null);
          showToast(editingId ? 'PINを更新しました' : '登録しました');
        } catch (e) { console.warn('[coachDir]', e); alert('保存できませんでした: ' + e.message); }
        finally { setBusy(false); }
      };

      const remove = async (id, nm) => {
        if (!confirm(`「${nm}」を顧問リストから削除しますか？\n（この名前でのPINログインができなくなります。承認済み端末はそのまま残ります）`)) return;
        try { await storage.removeCoachEntry(id); showToast('削除しました'); }
        catch (e) { alert('削除できませんでした: ' + e.message); }
      };

      // 承認済み端末（/coaches）。値がcoachIdならPINログイン由来、true はConsole手動登録
      const devices = Object.entries(coaches || {});
      const unlinkDevice = async (uid2) => {
        const mine = uid2 === myUid;
        if (!confirm((mine ? '⚠ これは今使っている端末です。解除すると顧問機能が使えなくなります。\n' : '') + 'この端末の顧問承認を解除しますか？')) return;
        try { await storage.removeCoachDevice(uid2); showToast('解除しました'); }
        catch (e) { alert('解除できませんでした: ' + e.message); }
      };

      return (
        <>
          <button className="btn-ghost mb-16" onClick={onBack}>← 顧問Dashboardに戻る</button>
          <div className="section-h">顧問リスト（PINログイン）</div>
          <div className="card">
            <div className="card-subtitle" style={{lineHeight:1.7}}>
              ここに登録した顧問は、新しい端末でもログイン画面の一覧から名前を選び、顧問PIN(6桁)を入れるだけで使い始められます（Firebase Consoleでの登録は不要になります）。
            </div>
          </div>
          {Object.entries(names).map(([id, nm]) => (
            <div key={id} className="list-item">
              <div><div className="title">{nm}</div></div>
              <div className="right" style={{display:'flex', gap:6}}>
                <button className="btn-ghost" style={{padding:'6px 10px', fontSize:12}} onClick={() => { setEditingId(id); setName(nm); setDirPin(''); }}>PIN変更</button>
                <button className="btn-ghost" style={{padding:'6px 10px', fontSize:12}} onClick={() => remove(id, nm)}>削除</button>
              </div>
            </div>
          ))}
          <div className="card mt-16">
            <div className="card-title">{editingId ? `PIN変更: ${names[editingId] || ''}` : '＋ 顧問を追加'}</div>
            <div className="form-group">
              <label>名前</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="例: 山田" disabled={!!editingId} />
            </div>
            <div className="form-group">
              <label>顧問PIN（6桁・端末をまたぐ本人確認用）</label>
              <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength="6" className="pin-input"
                value={dirPin} onChange={e => setDirPin(e.target.value.replace(/[^0-9]/g, ''))} placeholder="••••••" />
            </div>
            <div style={{display:'flex', gap:8}}>
              {editingId && <button className="btn btn-secondary" style={{flex:1}} onClick={() => { setEditingId(null); setName(''); setDirPin(''); }}>キャンセル</button>}
              <button className="btn" style={{flex:1}} disabled={busy} onClick={save}>{busy ? '保存中...' : (editingId ? 'PINを更新' : '登録')}</button>
            </div>
          </div>
          <div className="card mt-16">
            <div className="card-title">承認済み端末 {devices.length}台</div>
            <div className="card-subtitle">解除するとその端末は顧問機能を使えなくなります（復旧の最終手段はFirebase Console）。</div>
            {devices.map(([uid2, v]) => (
              <div key={uid2} className="stat-row">
                <span className="label">{typeof v === 'string' ? (names[v] || '(削除済み顧問)') : 'Console登録'}{uid2 === myUid ? '（この端末）' : ''}</span>
                <span className="value"><button className="btn-ghost" style={{padding:'4px 8px', fontSize:12}} onClick={() => unlinkDevice(uid2)}>解除</button></span>
              </div>
            ))}
          </div>
        </>
      );
    }
```

- [ ] **Step 2: `CoachDashboard` にタブを追加**

- signature `function CoachDashboard({ state, allUsersData, roster, rosterToUid, matches, ...` に `coaches,` を追加（`rosterToUid,` の直後）。
- 呼出し側（App内 `<CoachDashboard ... rosterToUid={rosterToUid}` の箇所）に `coaches={coaches}` を追加。
- タブ分岐（`if (tab === 'cloud') {...}` の直後）に追加:
```jsx
      if (tab === 'coachdir') {
        return <CoachDirectory coaches={coaches} myUid={myUid} showToast={showToast} onBack={() => setTab('overview')} />;
      }
```
- タブボタン群（`📥 CSVファイル取込` ボタンの直後）に追加:
```jsx
            <button className="btn btn-secondary" style={{flex:'1 1 auto'}} onClick={() => setTab('coachdir')}>👤 顧問リスト</button>
```

- [ ] **Step 3: 検証 → Commit**

`node tests/dedupe.test.js` PASS・差分の目視（括弧/JSX整合）。
```bash
git add index.html
git commit -m "feat: 顧問リスト管理画面（名前＋6桁PIN登録・PIN変更・承認済み端末の解除）"
```

---

### Task 13: ログイン画面の「登録済み顧問でログイン」

**Files:**
- Modify: `index.html` — `Login` コンポーネント

- [ ] **Step 1: Login に state と購読を追加**（既存の `const [savedPin, setSavedPin] = ...` 群の直後）

```jsx
      // 顧問ディレクトリ（PINログイン用の名前一覧）
      const [coachNames, setCoachNames] = useState({});
      const [selectedCoachId, setSelectedCoachId] = useState(null);
      const [coachPin, setCoachPin] = useState('');
      useEffect(() => storage.subscribeCoachNames(setCoachNames), []);
```

- [ ] **Step 2: ハンドラを追加**（`handleRegisterAsCoach` の直後）

```jsx
      // 登録済み顧問のPINログイン（新端末の自己承認）。PIN正誤はFirebaseルールが判定する
      const handleCoachPinLogin = async () => {
        if (!selectedCoachId || coachPin.length !== 6) return;
        setBusy(true);
        try {
          let myUid2 = authUid;
          if (!myUid2 && fbAuth) myUid2 = (await fbAuth.signInAnonymously()).user.uid;
          const hash = await hashCoachPin(coachPin);
          await storage.claimCoach(myUid2, selectedCoachId, hash);
          // 端末PINも同じ6桁で保存（次回この端末では同じPINで開ける）
          localStorage.setItem(PIN_KEY, await hashPinV2(coachPin));
          localStorage.setItem(NAME_KEY, coachNames[selectedCoachId] || '顧問');
          await onLogin({
            id: myUid2, name: coachNames[selectedCoachId] || '顧問', grade: 0,
            position: '顧問', rosterId: null, createdAt: Date.now(), isCoach: true
          });
        } catch (e) {
          console.warn('[coach pin login]', e);
          alert('ログインできませんでした。PINが違うか、通信エラーです。');
        } finally { setBusy(false); }
      };
```

- [ ] **Step 3: 顧問登録モードのUIに「登録済み顧問でログイン」カードを追加**

`// ── 顧問登録モード` ブロック内、`<div className="login-card">`（`<h2>顧問として登録</h2>` を含むカード）の**直前**に挿入:

```jsx
            {Object.keys(coachNames).length > 0 && (
              <div className="login-card" style={{marginBottom:12}}>
                <h2>登録済み顧問でログイン</h2>
                <div className="chip-group" style={{flexWrap:'wrap', marginBottom:12}}>
                  {Object.entries(coachNames).map(([cid, nm]) => (
                    <div key={cid} className={'chip ' + (selectedCoachId === cid ? 'selected' : '')} onClick={() => setSelectedCoachId(cid)}>{nm}</div>
                  ))}
                </div>
                {selectedCoachId && (
                  <>
                    <div className="form-group">
                      <label>顧問PIN（6桁）</label>
                      <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength="6" className="pin-input"
                        value={coachPin} onChange={e => setCoachPin(e.target.value.replace(/[^0-9]/g, ''))} placeholder="••••••" />
                    </div>
                    <button className="btn" disabled={busy || coachPin.length !== 6} onClick={handleCoachPinLogin}>
                      {busy ? '確認中...' : 'PINでログイン'}
                    </button>
                  </>
                )}
              </div>
            )}
```

あわせて既存カードの見出しを `<h2>顧問として登録</h2>` → `<h2>新しく顧問登録（初回のみ）</h2>` に変更し、
役割選択画面の説明行 `顧問 → 名前とPINで登録（承認制）` を `顧問 → 一覧から選んでPIN、初回のみ新規登録` に変更。

- [ ] **Step 4: 検証 → Commit**

`node tests/dedupe.test.js` PASS・差分目視。
```bash
git add index.html
git commit -m "feat: ログイン画面に登録済み顧問のPINログイン（新端末の自己承認）"
```

※ 受入（Task 9）に追記: 顧問リストに自分を登録 → 別ブラウザ（シークレットウィンドウ）で
一覧から選択＋PINログイン → 顧問Dashboardが開き、Console登録なしで承認されること。
誤PINで「ログインできませんでした」になること。

---

## Self-Review（計画作成時に実施済み）

- **Spec coverage**: ①重複統合＋再発防止=Task 4/5、②CSV取込=Task 6、③選手表示=実装済みのため対象外（planで明記）・コーチ一覧=Task 7/8、ルール=Task 3、④切替=Task 10。決定率定義は既存 `aggregateGameStats` に一致（変更不要）。
- **Spec からの意図的な変更**: コーチ一覧の LAB 指標は「常時列表示」でなく「ボタンでオンデマンド読込」（毎回 選手数×3 ノードの読取を避ける）。統合ツールの gameStats 再付替えは行わない（uid 配下なので原則無傷。conflict 時のみ再配信で復元）— spec の「統合で消えない」を満たす。
- **Type consistency**: `HMDedupe.dupKey/normalizeSurname/findRosterDuplicates/planMerge/resolveCsvRows/csvGameId` の名称・引数はTask 1 実装とTask 4-6 の呼出しで一致。`storage.saveGameStatsBulk / linkRosterToUid / unlinkRoster / deleteRoster / getMyLabCards / getMyLabNode` は index.html 既存実装の実名。
- **Placeholder scan**: TBDなし。全ステップに実コード・実コマンドあり。
