# Phase 2B: マイプレイブック統合表示 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mental の `MyStats`（ナビ「マイ統計」）に「あなたの積み上げ」要約カード＋①行動宣言・②振り返り・③課題タイルを足し、選手の全記録を1画面で見返せるようにする。

**Architecture:** 対象は `handball-mental/index.html` の `MyStats` コンポーネント1つ。データは全て mental 自身の `state`（declarations・reflections）か、Phase 1 の橋 `storage.getMyLabNode(authUid, 'tbTasks')` で既に読めるもの。**新しい Firebase 同期・ルール変更・LAB 側の変更は一切なし。** ③のLAB読み取りは既存の LAB読み取り useEffect に相乗りさせ、新しい useEffect を増やさない。

**Tech Stack:** 単一 HTML（Babel CDN + React + firebase v10 compat）。ユニットテスト機構なし → 検証はローカル起動＋実ブラウザ（`preview_start` の "mental"）。

**スペック:** `handball-mental/docs/superpowers/specs/2026-07-15-phase2b-myplaybook-design.md`

**データ形（実測済み）:**
- `state.declarations`: `{id, declaration, startDate, checks:[], completed, completedAt, createdAt}`
- `state.reflections`: `{id, createdAt, gameDate, opponent, result, bestPlay, coachWord, nextTask}`
- LAB `tbTasks`（橋で読取）: `{id, name, version, sessions:[], ...}`

**地雷（絶対禁止）:**
- `users/{uid}/state` の保存経路（saveCloud debounce ~1230-1242行）・`aggregateGameStats` を変更しない
- LAB リポジトリ（handball-system）には触らない
- 既存の心の5つの力・フィジカル・予防/負荷/同意・LAB連携コーナー・試合データ表示を壊さない
- 新しい useEffect を増やさない（③は既存の LAB読み取り useEffect に相乗り）
- mental への git push は本番反映。オーナー承認後のみ

**挿入位置の基準:** `MyStats` は `index.html` 4952行〜。LAB読み取り state は 4989-4991行、LAB読み取り useEffect は 4992-5026行、return の `<>` は 5032-5033行（直後に「心の5つの力」ブロック）。

---

### Task 1: ③のデータ層 — tbStat state と tbTasks 読み取り

**Files:**
- Modify: `handball-mental/index.html`（`MyStats` 内・4989〜5026行付近）

- [ ] **Step 1: tbStat state を追加**

LAB読み取り state 群（`const [yomiStat, setYomiStat] = useState(null);` などがある 4989-4991行付近）の直後に1行追加:

```js
      const [tbStat, setTbStat] = useState(null);
```

- [ ] **Step 2: 既存の LAB読み取り useEffect に tbTasks 読み取りを相乗り**

同 useEffect 内、`storage.getMyLabNode(authUid, 'pvRecords')...` の `.catch(...)` が閉じた直後（`setPvStat(null); });` の後、`return () => { alive = false; };` の前）に追加:

```js
        storage.getMyLabNode(authUid, 'tbTasks')
          .then(recs => {
            if (!alive) return;
            const list = (recs || []).filter(Boolean);
            setTbStat(list.length > 0
              ? { n: list.length, names: list.slice(0, 3).map(t => t && t.name).filter(Boolean) }
              : null);
          })
          .catch(e => { console.debug('[lab tb]', e); if (alive) setTbStat(null); });
```

また、同 useEffect 冒頭の未認証リセット行（`if (!authUid) { setYomiStat(null); setGkPredStat(null); setPvStat(null); return; }`）に `setTbStat(null);` を追加:

```js
        if (!authUid) { setYomiStat(null); setGkPredStat(null); setPvStat(null); setTbStat(null); return; }
```

- [ ] **Step 3: 構文の目視確認**

Run: `node -e "const s=require('fs').readFileSync('index.html','utf8'); const o=(s.match(/{/g)||[]).length, c=(s.match(/}/g)||[]).length; console.log('braces', o, c, o===c?'OK':'MISMATCH')"`（handball-mental で実行）
Expected: `braces <n> <n> OK`（開き閉じ一致）

- [ ] **Step 4: コミット**

```bash
git add index.html
git commit -m "feat(mystats): LABの課題(tbTasks)読み取りtbStatを既存useEffectに相乗り"
```

コミットメッセージ末尾に追加:
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

### Task 2: 要約カード＋①行動宣言タイル＋②振り返りタイル

**Files:**
- Modify: `handball-mental/index.html`（`MyStats` return 冒頭・5032-5033行付近）

- [ ] **Step 1: return の `<>` 直後に3ブロックを挿入**

`return (` の次行 `<>`（5033行）の直後、`{(state.selfChecks && ...` の**前**に以下をまとめて挿入:

```jsx
          {/* 🗂 あなたの積み上げ（1枚集約） */}
          {(() => {
            const decls = state.declarations || [];
            const declDone = decls.filter(d => d.completed).length;
            const declActive = decls.filter(d => !d.completed).length;
            const reflN = (state.reflections || []).length;
            return (
              <>
                <div className="section-h">🗂 あなたの積み上げ</div>
                <div className="card mb-16">
                  <div className="stat-row"><span className="label">🎯 行動宣言</span><span className="value">達成 {declDone}／進行中 {declActive}</span></div>
                  <div className="stat-row"><span className="label">📝 振り返り</span><span className="value">累計 {reflN} 本</span></div>
                  {yomiStat && <div className="stat-row"><span className="label">🔮 読み的中率</span><span className="value">{yomiStat.pct}%</span></div>}
                  {tbStat && <div className="stat-row"><span className="label">🛠 課題</span><span className="value">{tbStat.n} 件</span></div>}
                </div>
              </>
            );
          })()}

          {/* ① 行動宣言タイル */}
          {(() => {
            const decls = state.declarations || [];
            const active = decls.filter(d => !d.completed);
            const done = decls.filter(d => d.completed);
            return (
              <>
                <div className="section-h">🎯 行動宣言</div>
                <div className="card mb-16">
                  {active.length === 0 && done.length === 0 ? (
                    <>
                      <div className="card-subtitle">まだ宣言がありません</div>
                      <button className="btn-ghost mt-16" style={{width:'100%'}} onClick={() => onNav && onNav('declaration')}>行動宣言を始める →</button>
                    </>
                  ) : (
                    <>
                      {active.map(d => (
                        <div key={d.id} className="stat-row">
                          <span className="label">進行中</span>
                          <span className="value" style={{maxWidth:'75%', textAlign:'right'}}>「{d.declaration}」・{(d.checks || []).length}日</span>
                        </div>
                      ))}
                      <div className="stat-row"><span className="label">完了した宣言</span><span className="value">{done.length} 件{decls.length > 0 ? `（達成率 ${Math.round(done.length / decls.length * 100)}%）` : ''}</span></div>
                      <button className="btn-ghost mt-16" style={{width:'100%'}} onClick={() => onNav && onNav('declaration')}>宣言を開く →</button>
                    </>
                  )}
                </div>
              </>
            );
          })()}

          {/* ② 振り返りタイル */}
          {(() => {
            const refs = (state.reflections || []).slice().sort((a, b) => (b.gameDate || '').localeCompare(a.gameDate || ''));
            return (
              <>
                <div className="section-h">📝 振り返り</div>
                <div className="card mb-16">
                  {refs.length === 0 ? (
                    <div className="card-subtitle">まだ振り返りがありません</div>
                  ) : (
                    <>
                      <div className="stat-row"><span className="label">累計</span><span className="value">{refs.length} 本</span></div>
                      <div className="stat-row"><span className="label">最後に書いた日</span><span className="value">{refs[0].gameDate || '—'}</span></div>
                      {refs.slice(0, 3).map(r => (
                        <div key={r.id} className="stat-row"><span className="label">{(r.gameDate || '').slice(5)}</span><span className="value" style={{maxWidth:'70%', textAlign:'right'}}>{r.bestPlay || r.coachWord || `結果 ${r.result || '?'}`}</span></div>
                      ))}
                    </>
                  )}
                  <button className="btn-ghost mt-16" style={{width:'100%'}} onClick={() => onWriteReflection && onWriteReflection()}>振り返りを書く →</button>
                </div>
              </>
            );
          })()}

```

- [ ] **Step 2: 構文の目視確認**

Run: `node -e "const s=require('fs').readFileSync('index.html','utf8'); const o=(s.match(/{/g)||[]).length, c=(s.match(/}/g)||[]).length; console.log('braces', o, c, o===c?'OK':'MISMATCH')"`
Expected: `braces <n> <n> OK`

- [ ] **Step 3: コミット**

```bash
git add index.html
git commit -m "feat(mystats): 要約カード「あなたの積み上げ」＋行動宣言・振り返りタイルを追加"
```

末尾に Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

### Task 3: ③課題タイル（LAB・tbStat 使用）

**Files:**
- Modify: `handball-mental/index.html`（`MyStats` return・Task 2 で入れた②振り返りタイルの直後）

- [ ] **Step 1: ②振り返りタイルの閉じ `})()}` の直後に挿入**

```jsx
          {/* ③ 課題タイル（LAB・読めなければ非表示） */}
          {tbStat && (
            <>
              <div className="section-h">🛠 課題（LAB）</div>
              <div className="card mb-16">
                <div className="stat-row"><span className="label">作った課題</span><span className="value">{tbStat.n} 件</span></div>
                {tbStat.names.map((nm, i) => (
                  <div key={i} className="stat-row"><span className="label">・</span><span className="value" style={{maxWidth:'80%', textAlign:'right'}}>{nm}</span></div>
                ))}
                <button className="btn-ghost mt-16" style={{width:'100%'}}
                  onClick={() => window.open('https://ganchi2014-tech.github.io/handball-system/', '_blank')}>LABで課題を作る →</button>
              </div>
            </>
          )}

```

- [ ] **Step 2: 構文の目視確認**

Run: `node -e "const s=require('fs').readFileSync('index.html','utf8'); const o=(s.match(/{/g)||[]).length, c=(s.match(/}/g)||[]).length; console.log('braces', o, c, o===c?'OK':'MISMATCH')"`
Expected: `braces <n> <n> OK`

- [ ] **Step 3: コミット**

```bash
git add index.html
git commit -m "feat(mystats): 課題（LAB tbTasks）タイルを追加"
```

末尾に Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

### Task 4: ブラウザ検証・受け入れ・push

**Files:** なし（検証とデプロイ）

- [ ] **Step 1: ローカル起動**

`preview_start` で launch.json の "mental"（python http.server 3344）を起動。

- [ ] **Step 2: マイ統計を開いて表示確認**

- ログイン → ナビ「📈 マイ統計」を開く
- 先頭に「🗂 あなたの積み上げ」カード（行動宣言・振り返りの行が必ず出る）
- 「🎯 行動宣言」タイル（宣言があれば内容、無ければ「まだ宣言がありません」＋導線）
- 「📝 振り返り」タイル（あれば累計・最近、無ければ空メッセージ＋「振り返りを書く →」）
- LAB連携済みなら「🛠 課題（LAB）」タイルと要約の🔮🛠行、未連携なら③非表示でも①②と要約（宣言・振り返り行）は出る
- `read_console_messages`（onlyErrors）で debug 以外のエラーが無いこと

- [ ] **Step 3: スクリーンショットで証跡**

`computer` screenshot でマイ統計画面を撮り、ユーザーに提示。

- [ ] **Step 4: サーバー停止**

`preview_stop`。

- [ ] **Step 5: オーナー承認を得て push（本番反映）**

```bash
git push origin main
```

注: push 前に必ずオーナーに確認。ルール変更なしなので `firebase deploy` は不要。

- [ ] **Step 6: メモリ更新**

`MEMORY.md` と Phase 連携メモリに Phase 2B 完了・コミットID・残（Phase 2A=LAB引き算、2C=動線統合、2B次点=④トレンド⑤効いた技）を記録。
