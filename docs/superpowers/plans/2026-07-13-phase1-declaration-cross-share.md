# Phase 1: 宣言相互乗り入れ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LABの行動宣言をmentalに、mentalの行動宣言をLABに、それぞれ読み取り専用で相互表示する。

**Architecture:** 既存の labLinks × rosterToUid ブリッジをそのまま使う。新設は (1) `lab/{labUid}/declaration`（LAB→mental、既存labルール内・ルール変更不要）と (2) `declShared/{mentalUid}`（mental→LAB、ルール新設）の2ノードのみ。両方向とも閲覧専用・正本は元アプリ。

**Tech Stack:** handball-system = Vite + React 18 + firebase modular SDK（dynamic import厳守）+ Vitest。handball-mental = 単一 index.html（Babel CDN + firebase v10 compat）。ルール検証 = `.scripts/verify-lab-rules.mjs`（本番RTDB実測・自削除）。

**スペック:** `handball-mental/docs/superpowers/specs/2026-07-13-declaration-cross-share-design.md`

**実施順序（重要）:** Task 1（ルール）→ Task 2（ルール検証）→ Task 3〜5（LAB側）→ Task 6〜8（mental側）→ Task 9（受け入れ・デプロイ）。ルールを先にデプロイしないと declShared への書き込みが PERMISSION_DENIED になる。

**地雷（両リポ共通の絶対禁止）:**
- `/rosterToUid` への書き込みは絶対禁止（読むだけ）。テストでも書かない。
- LAB `fb.js` 以外で firebase を import しない。fb.js 内もトップレベル import 禁止（dynamic import のみ）。
- mental `users/{uid}/state` のルールは一切触らない。
- LAB の `STORAGE_VERSION` を上げない。
- mental への git push は本番反映（GitHub Pages）。オーナー承認後のみ。LAB の main push も同様。

---

### Task 1: database.rules.json に declShared を新設

**Files:**
- Modify: `handball-mental/database.rules.json`（`labShared` ブロックの直後、99〜104行付近）

- [ ] **Step 1: ルール追加**

`"labShared": {...}` ブロックの閉じ `}` の後にカンマを足し、以下を追加:

```json
    "declShared": {
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || root.child('labLinks').child($uid).child('labUid').val() === auth.uid || root.child('coaches').child(auth.uid).exists())",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
```

意味: 書き込みは本人（mental選手）のみ。読み取りは本人・ブリッジ済みLABアカウント（`labLinks/{mentalUid}/labUid === auth.uid`）・顧問。`lab/{$uid}` の既存 read ルール（86行）と同じ三者構成。

- [ ] **Step 2: JSON構文チェック**

Run: `node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8')); console.log('OK')"`（handball-mental で実行）
Expected: `OK`

- [ ] **Step 3: コミット**

```bash
git add database.rules.json
git commit -m "feat(rules): declShared を新設（mental宣言のLAB向けミラー・本人write/ブリッジread）"
```

- [ ] **Step 4: ルールを本番デプロイ（オーナー確認の上）**

Run: `firebase deploy --only database`（handball-mental で実行）
Expected: `Deploy complete!`
注: declShared は新規ノードで本番はまだ空。既存パスのルールは1文字も変えていないため既存機能への影響なし。

### Task 2: verify-lab-rules.mjs に declShared テストを追加して実測

**Files:**
- Modify: `handball-system/.scripts/verify-lab-rules.mjs`

- [ ] **Step 1: 書き込みガードの許可リストに declShared を追加**

`isAllowedWritePath` 関数（72〜81行）の for ループ内、`labLinks/${uid}` の行の後に追加:

```js
    // declShared はキーが「mental側uid」。テストでは既知uid（A/B）を mentalUid 役に使う。
    if (path === `declShared/${uid}`) return true;
```

- [ ] **Step 2: テスト25〜30を追加**

24番のテスト（`B read /lab/{A} after unlink`）の閉じの後、`} finally {` の前に追加:

```js
    // ── declShared（Phase 1 宣言ミラー）。B を「mental側uid」、A を「LAB側uid」役として検証 ──

    // 25. B(mental役) が declShared/{B} を書く -> ALLOW（本人write）
    await expectAllow('B write /declShared/{B} (own mirror)', async () => {
      await set(guardedWriteRef(dbB, `declShared/${uidB}`), {
        declarations: [{ id: 'vd1', declaration: 'test', startDate: '2026-07-13', checkCount: 0, completed: false }],
        updatedAt: 1,
      });
    });

    // 26. B が declShared/{B} を読む -> ALLOW（本人read）
    await expectAllow('B read /declShared/{B}', async () => {
      await get(ref(dbB, `declShared/${uidB}`));
    });

    // 27. ブリッジ未登録の A が declShared/{B} を読む -> DENY（第三者read遮断）
    await expectDeny('A read /declShared/{B} before bridge', async () => {
      await get(ref(dbA, `declShared/${uidB}`));
    });

    // 28. A が labLinks/{B} を再作成（16番と同じ）後、declShared/{B} を読む -> ALLOW（ブリッジread）
    await expectAllow('A read /declShared/{B} via bridge', async () => {
      await set(guardedWriteRef(dbA, `labLinks/${uidB}`), { labUid: uidA, rosterId: 'vtest-rid', updatedAt: 1 });
      await get(ref(dbA, `declShared/${uidB}`));
    });

    // 29. A が declShared/{B} を書く -> DENY（LAB側からは読むだけ・書けない）
    await expectDeny('A write /declShared/{B} (read-only for LAB)', async () => {
      await set(guardedWriteRef(dbA, `declShared/${uidB}`), { declarations: [], updatedAt: 2 });
    });

    // 30. B が declShared/{B} を削除 -> ALLOW（本人による撤去・クリーンアップ兼用）
    await expectAllow('B remove /declShared/{B}', async () => {
      await remove(guardedWriteRef(dbB, `declShared/${uidB}`));
    });
```

- [ ] **Step 3: finally のクリーンアップに declShared と labLinks の後始末を追加**

`finally` ブロック内の labLinks/{B} 削除 try の前に追加（30番が途中失敗した場合の保険）:

```js
    try {
      if (uidB) {
        await remove(guardedWriteRef(dbB, `declShared/${uidB}`)).catch(() => {});
      }
    } catch (_) {
      // ignore
    }
```

注: 28番で labLinks/{B} を再作成しているが、既存の finally に labLinks/{B} の削除があるためそのまま掃除される。

- [ ] **Step 4: 実行して30本全PASSを確認**

Run: `node .scripts/verify-lab-rules.mjs`（handball-system で実行。Task 1 のルールデプロイ後であること）
Expected: 末尾に `ALL TESTS PASSED`（30行すべて PASS。既存1〜24の退行がないことも同時に確認される）

- [ ] **Step 5: コミット**

```bash
git add .scripts/verify-lab-rules.mjs
git commit -m "test(rules): declShared の権限マトリクス6本を追加（25-30・全30本PASS実測）"
```

### Task 3: LAB fb.js — 宣言push・mental宣言取得APIと純関数

**Files:**
- Modify: `handball-system/app/src/lib/fb.js`
- Test: `handball-system/tests/fb-decl.test.js`（新規）

- [ ] **Step 1: 純関数のテストを書く（失敗する状態）**

`tests/fb-decl.test.js` を新規作成:

```js
import { describe, it, expect } from 'vitest';
import { fbNormalizeMentalDecls } from '../app/src/lib/fb.js';

describe('fbNormalizeMentalDecls（declShared スナップショット → 表示モデル）', () => {
  it('null・非オブジェクト・declarations欠落は null', () => {
    expect(fbNormalizeMentalDecls(null)).toBeNull();
    expect(fbNormalizeMentalDecls('x')).toBeNull();
    expect(fbNormalizeMentalDecls({})).toBeNull();
    expect(fbNormalizeMentalDecls({ declarations: 'not-array' })).toBeNull();
  });

  it('進行中のみ active に入り、完了は completedCount に数える', () => {
    const v = fbNormalizeMentalDecls({
      declarations: [
        { id: 'a', declaration: '毎朝ストレッチ', startDate: '2026-07-01', checkCount: 5, completed: false },
        { id: 'b', declaration: '夜スマホ断ち', startDate: '2026-06-01', checkCount: 20, completed: true },
      ],
      updatedAt: 123,
    });
    expect(v.active).toHaveLength(1);
    expect(v.active[0].declaration).toBe('毎朝ストレッチ');
    expect(v.completedCount).toBe(1);
    expect(v.updatedAt).toBe(123);
  });

  it('declaration テキストが空のエントリは除外する', () => {
    const v = fbNormalizeMentalDecls({
      declarations: [{ id: 'a', declaration: '', completed: false }, null],
      updatedAt: 0,
    });
    expect(v.active).toHaveLength(0);
    expect(v.completedCount).toBe(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/fb-decl.test.js`（handball-system で実行）
Expected: FAIL（`fbNormalizeMentalDecls` is not exported）

- [ ] **Step 3: fb.js に実装を追加**

`fbSetLoopState`（145〜149行）の直後に追加:

```js
// LAB の行動宣言（next-declaration）を /lab/{uid}/declaration へ丸ごと set（単一値・一方向ミラー）。
// mental の宣言画面が「⚡プレーの宣言」としてブリッジ経由で読む。失敗は呼び元で握りつぶしてよい（非致命）。
export async function fbSetDeclaration(value) {
  if (!uid || !db) throw new Error('fbSetDeclaration: 未接続です（fbConnect を先に）');
  const { dbMod } = await importFirebase();
  await dbMod.set(dbMod.ref(db, 'lab/' + uid + '/declaration'), value);
}

// mental の宣言ミラー /declShared/{mentalUid} を一回読み（読めるのはブリッジ済み時のみ・ルールが判定）。
// 読めない/未設定なら null。書き込みAPIは存在しない（LAB側は閲覧専用・追加禁止）。
export async function fbGetMentalDecls(mentalUid) {
  if (!uid || !db) throw new Error('fbGetMentalDecls: 未接続です（fbConnect を先に）');
  if (!mentalUid) return null;
  const { dbMod } = await importFirebase();
  const snap = await dbMod.get(dbMod.ref(db, 'declShared/' + mentalUid));
  return fbNormalizeMentalDecls(snap.val());
}
```

「純関数」セクション（`// ─── 純関数（firebase 非依存・テスト対象） ───` の下）に追加:

```js
// declShared スナップショット → 表示モデル {active, completedCount, updatedAt}。不正形は null。
export function fbNormalizeMentalDecls(val) {
  if (!val || typeof val !== 'object' || !Array.isArray(val.declarations)) return null;
  const list = val.declarations.filter(d => d && String(d.declaration || '').trim());
  const active = list.filter(d => !d.completed);
  return { active, completedCount: list.length - active.length, updatedAt: val.updatedAt || 0 };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/fb-decl.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: 既存テスト全体も通ることを確認**

Run: `npm test`（handball-system で実行）
Expected: 全テストPASS（136+ 既存 + 3 新規）

- [ ] **Step 6: コミット**

```bash
git add app/src/lib/fb.js tests/fb-decl.test.js
git commit -m "feat(fb): 宣言の一方向push（fbSetDeclaration）とmental宣言ミラー取得（fbGetMentalDecls）を追加"
```

### Task 4: LAB App.jsx — 宣言push効果とmental宣言の取得

**Files:**
- Modify: `handball-system/app/src/App.jsx`

- [ ] **Step 1: import に2関数を追加**

16行目の import に `fbSetDeclaration, fbGetMentalDecls` を追加:

```js
import { FB_NODES, fbConnect, fbUid, fbPush, fbFullSync, fbFlushQueue, fbSubscribeRoster, fbCheckRosterLink, fbWriteLabLink, fbSetLoopState, fbSetDeclaration, fbGetMentalDecls, fbQueueAdd, fbRosterToPlayers, fbShareYomi, fbPullShared, fbRemoveShared, buildSharedYomi } from './lib/fb.js';
```

- [ ] **Step 2: 宣言の一方向push効果を追加**

loopState の push 効果（384〜387行、`fbSetLoopState` を呼ぶ useEffect）の直後に追加:

```js
  // 行動宣言を一方向 push（接続確立時＋変更時）。loopState と同じ非致命ミラー方式。
  // mental の宣言画面（⚡プレーの宣言）がブリッジ経由でこれを読む。
  useEffect(() => {
    if (!fbEnabled || fbStatus !== 'on' || !declaration) return;
    fbSetDeclaration(declaration).catch(() => {});
  }, [fbEnabled, fbStatus, declaration]);
```

- [ ] **Step 3: mental宣言の取得stateと効果を追加**

Step 2 で追加したコードの直後に追加:

```js
  // mental の宣言ミラー（🧠 メンタルの宣言）。接続確立後に一回読み。読めなければ非表示が正。
  const [mentalDecls, setMentalDecls] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!fbEnabled || fbStatus !== 'on' || !fbLink.rosterId) { setMentalDecls(null); return; }
    (async () => {
      try {
        const { linkedUid, mine } = await fbCheckRosterLink(fbLink.rosterId);
        if (!linkedUid || mine) return; // mental未連携（またはuid同一の異常系）は表示なし
        const v = await fbGetMentalDecls(linkedUid);
        if (alive) setMentalDecls(v);
      } catch (e) { /* 非致命: カード非表示のまま */ }
    })();
    return () => { alive = false; };
  }, [fbEnabled, fbStatus, fbLink.rosterId]);
```

- [ ] **Step 4: LoopHome に prop を渡す**

1213行付近の `<LoopHome` に `mentalDecls={mentalDecls}` を追加:

```jsx
        <LoopHome
          loopState={loopState}
          onSetNextMatch={(nm) => setLoopState(prev => ({ ...prev, nextMatch: nm }))}
          declaration={declaration} decSnooze={decSnooze}
          mentalDecls={mentalDecls}
          onAnswerDeclaration={answerDeclaration} onSnooze={() => setDecSnooze(true)}
```

- [ ] **Step 5: ビルドが通ることを確認**

Run: `npm run build`（handball-system で実行）
Expected: エラーなし（`dist/` 生成）

- [ ] **Step 6: コミット**

```bash
git add app/src/App.jsx
git commit -m "feat(app): 宣言をFirebaseへ一方向push＋mental宣言ミラーを取得してLoopHomeへ"
```

### Task 5: LAB loop.jsx — 「🧠 メンタルの宣言」カード表示

**Files:**
- Modify: `handball-system/app/src/components/loop.jsx`（LoopHome、37行〜）

- [ ] **Step 1: props に mentalDecls を追加**

37行の LoopHome シグネチャに `mentalDecls` を追加:

```js
function LoopHome({ loopState, onSetNextMatch, declaration, decSnooze, mentalDecls, onAnswerDeclaration, onSnooze,
```

- [ ] **Step 2: カードを追加**

既存の宣言表示ブロック（64行 `{declaration && (` から始まるブロック）の**閉じた直後**に追加。読み取り専用・操作ボタンなし:

```jsx
      {mentalDecls && mentalDecls.active.length > 0 && (
        <div className="hub-declare">
          <div className="hub-declare-label">🧠 メンタルの宣言（mentalアプリから・こちらでは見るだけ）</div>
          {mentalDecls.active.map(d => (
            <div key={d.id} className="hub-declare-text">
              「{d.declaration}」<span className="loop-declare-mini">（{d.startDate}〜・チェック{d.checkCount || 0}日）</span>
            </div>
          ))}
        </div>
      )}
```

注: className は既存の宣言カード（`hub-declare` / `hub-declare-text` / `loop-declare-mini`）を流用し、新規CSSは書かない。

- [ ] **Step 3: テストとビルド**

Run: `npm test && npm run build`
Expected: 全テストPASS・ビルド成功

- [ ] **Step 4: コミット**

```bash
git add app/src/components/loop.jsx
git commit -m "feat(loop): ループホームに「メンタルの宣言」読み取り専用カードを追加"
```

### Task 6: mental storage — declShared ミラー書き込みAPI

**Files:**
- Modify: `handball-mental/index.html`（storage オブジェクト、873行 `getMyLabSingleton` の後）

- [ ] **Step 1: storage に saveDeclShared を追加**

`getMyLabSingleton` の閉じ `}` の後にカンマを足して追加:

```js
      ,
      // ----- 宣言ミラー（declShared/{uid}・LAB の「メンタルの宣言」カード用） -----
      // state.declarations の要約だけを書く。state 本体（夜間ログ・IZOF等）は絶対にここへ入れない。
      saveDeclShared: async (authUid, summary) => {
        if (!fbDB || !authUid) return;
        return fbDB.ref('declShared/' + authUid).set({
          declarations: summary,
          updatedAt: firebase.database.ServerValue.TIMESTAMP
        });
      }
```

- [ ] **Step 2: コミット**

```bash
git add index.html
git commit -m "feat(storage): declShared ミラー書き込みAPIを追加（宣言要約のみ・state本体は含めない）"
```

### Task 7: mental App — ミラー書き込み効果とLAB宣言の取得

**Files:**
- Modify: `handball-mental/index.html`（App コンポーネント内）

- [ ] **Step 1: 宣言ミラーの書き込み効果を追加**

labLoop の useEffect（1088〜1097行）の直後に追加:

```js
      // ── 宣言ミラー（declShared/{uid}）: declarations の要約が変わったときだけ書く。
      // checks は日付配列のまま出さず件数に要約（LAB に日々の詳細まで見せる必要はない）
      const lastDeclJsonRef = useRef('');
      useEffect(() => {
        if (!authUid || !state.user || state.user.isCoach) return;
        const summary = (state.declarations || []).map(d => ({
          id: d.id,
          declaration: d.declaration,
          startDate: d.startDate || '',
          checkCount: (d.checks || []).length,
          completed: !!d.completed
        }));
        const json = JSON.stringify(summary);
        if (json === lastDeclJsonRef.current) return;
        lastDeclJsonRef.current = json;
        storage.saveDeclShared(authUid, summary).catch(e => console.debug('[declShared]', e));
      }, [state.declarations, authUid, state.user]);
```

- [ ] **Step 2: LAB宣言の取得を追加**

Step 1 で追加したコードの直後に追加（labLoop と同じ一回読みパターン）:

```js
      // ── LAB の行動宣言（⚡プレーの宣言）を一回読み — 宣言画面のカード用（読めなければ非表示が正）
      const [labDecl, setLabDecl] = useState(null);
      useEffect(() => {
        let alive = true;
        if (!authUid) { setLabDecl(null); return; }
        storage.getMyLabSingleton(authUid, 'declaration')
          .then(v => { if (alive) setLabDecl(v); })
          .catch(e => { console.debug('[lab decl]', e); if (alive) setLabDecl(null); });
        return () => { alive = false; };
      }, [authUid]);
```

- [ ] **Step 3: Declarations に prop を渡す**

1371〜1373行を変更:

```jsx
            {view === 'declaration' && (
              <Declarations state={state} update={update} showToast={showToast} labDecl={labDecl} />
            )}
```

- [ ] **Step 4: コミット**

```bash
git add index.html
git commit -m "feat(app): 宣言要約をdeclSharedへミラー＋LAB宣言を取得して宣言画面へ"
```

### Task 8: mental Declarations — 「⚡プレーの宣言」カード表示

**Files:**
- Modify: `handball-mental/index.html`（Declarations コンポーネント、3222行〜）

- [ ] **Step 1: シグネチャに labDecl を追加**

```js
    function Declarations({ state, update, showToast, labDecl }) {
```

- [ ] **Step 2: カードを追加**

`<div className="section-h">行動宣言</div>`（3261行）の直後に追加。読み取り専用・操作なし:

```jsx
          {labDecl && labDecl.text && (
            <div className="card">
              <div className="card-title">⚡ プレーの宣言（LABから・ここでは見るだけ）</div>
              <div style={{marginTop:8}}>「{labDecl.text}」</div>
              <div className="text-small text-muted" style={{marginTop:6}}>
                {labDecl.done === true ? '✅ 達成ずみ' : labDecl.done === false ? '△ まだ — 次の練習で' : '🎯 宣言中'}
                {' ・振り返りはLABアプリで'}
              </div>
            </div>
          )}
```

- [ ] **Step 3: ローカルで表示確認**

Run: `npx serve .`（handball-mental で実行。または `python -m http.server 8000`）
ブラウザで `http://localhost:3000`（serve の表示ポート）を開き:
- 選手アカウントで宣言画面を開く → LAB未連携なら「⚡プレーの宣言」カードが**出ない**こと（エラーも出ない）
- コンソールに `[declShared]` / `[lab decl]` の debug 以外のエラーがないこと
Expected: 既存の宣言機能が従来どおり動く・新カードは連携時のみ

- [ ] **Step 4: コミット**

```bash
git add index.html
git commit -m "feat(decl): 宣言画面に「プレーの宣言（LABから）」読み取り専用カードを追加"
```

### Task 9: 受け入れ確認と本番デプロイ

**Files:** なし（検証とデプロイのみ）

- [ ] **Step 1: LAB 全テスト最終確認**

Run: `npm test`（handball-system）
Expected: 全PASS

- [ ] **Step 2: ルール検証の再実行（回帰確認）**

Run: `node .scripts/verify-lab-rules.mjs`（handball-system）
Expected: `ALL TESTS PASSED`（30本）

- [ ] **Step 3: オーナー承認を得て両リポを push（本番反映）**

```bash
# handball-system（CIがテスト→ビルド→Pagesデプロイ。CI赤なら本番に届かない）
git push origin main
# handball-mental（push = GitHub Pages 本番反映）
git push origin main
```

注: **push 前に必ずオーナーに確認**（両リポの運用ルール）。

- [ ] **Step 4: 実機E2E（受け入れ基準・spec §受け入れ確認）**

LAB連携済みの生徒端末（またはテスト用に名簿連携した2ブラウザ）で:
1. LAB で振り返り→「次に試すこと」を宣言 → mental の宣言画面に「⚡プレーの宣言」が出る
2. mental で行動宣言を開始 → LAB のループホームに「🧠 メンタルの宣言」が出る
3. LAB未連携の生徒: 両アプリともカードが出ない・エラーなし
4. （2の裏取り）verify-lab-rules.mjs の27番PASSで他人読み取り遮断は実測済み

- [ ] **Step 5: メモリ更新**

`MEMORY.md` と関連メモリファイルに Phase 1 完了・コミットID・残タスク（Phase 2=プレイブック移植、Phase 3=顧問ビュー）を記録。
