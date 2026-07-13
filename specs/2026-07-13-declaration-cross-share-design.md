# LAB × mental 連携拡張 設計書（宣言相互乗り入れ・プレイブック・顧問ビュー）

日付: 2026-07-13
状態: 設計承認済み・実装前
前提: `specs/2026-07-08-lab-bridge-design.md`（labLinks × rosterToUid 二重照合の橋）が本番稼働中

## 目的

HANDBALL LAB（handball-system）と handball-mental のデータ連携を完成させる。
優先順位は C→A→B で段階実施する。

- **Phase 1（C）**: 行動宣言の相互乗り入れ — 7/16 の S2 前に本番反映
- **Phase 2（A）**: mental のマイ統計にマイプレイブックを再現 — 夏休み中
- **Phase 3（B）**: 顧問ダッシュボードに LAB 列を追加 — 夏休み中、Phase 1・2 の実績を積んでから

## 決定事項（ブレスト結果）

1. 宣言は **相互乗り入れ**: どちらのアプリを開いても両方の宣言が見える
2. 正本は元のアプリ（LAB の宣言は LAB、mental の宣言は mental）。相手側は**常に閲覧のみ**。双方向書き込みはしない
3. LAB に `users/{uid}/state` 本体は読ませない。宣言だけを専用ミラーノードに複製し、夜間ログ・IZOF 等の内面データは非公開のまま守る

## Phase 1: 宣言の相互乗り入れ

### 1-1. LAB → mental（LAB の行動宣言を mental で表示）

- LAB の `next-declaration`（localStorage、現在 Firebase 同期対象外）を同期対象に追加する
  - Firebase パス: `lab/{labUid}/declaration`（単一オブジェクト）
  - スキーマ: `{ text, ts, mode, done, answeredTs }`（LAB の既存構造そのまま）
  - 実装: `app/src/lib/fb.js` の `FB_NODES` に singleton として追加（`loopState` と同じ一方向ミラー方式）
- mental 側: 既存の `getMyLabSingleton`（`index.html`、loopState の読み方と同一パターン）で `lab/{labUid}/declaration` を読み、宣言画面に「⚡プレーの宣言（LABから）」カードを**読み取り専用**で表示
- LAB 未連携（`resolveLabUid` が null）の場合はカード自体を非表示。エラー表示にしない

### 1-2. mental → LAB（mental の行動宣言を LAB で表示）

- mental が宣言（`state.declarations`）の保存時に、宣言データのみを新設ノードへミラー書き込みする
  - Firebase パス: `declShared/{mentalUid}`
  - スキーマ:
    ```json
    {
      "declarations": [
        { "id": "...", "declaration": "...", "startDate": "...", "checkCount": 5, "completed": false }
      ],
      "updatedAt": 1234567890
    }
    ```
  - `checks` 配列は件数（`checkCount`）に要約して書く。日々のチェック詳細まで LAB に出す必要はない
  - 実装: mental の state 保存関数（`users/{uid}/state` への set 箇所）にフックし、`declarations` が変化したときのみミラーを更新
- LAB 側: 既存許可のある `rosterToUid[rosterId]` 読み取りで mentalUid を取得し、`declShared/{mentalUid}` を購読。「🧠 メンタルの宣言」カードを**読み取り専用**で表示
- 未連携時はカード非表示

### 1-3. セキュリティルール（database.rules.json）

- `declShared/{$uid}` を新設:
  - **write**: 本人（`auth.uid === $uid`）のみ
  - **read**: 本人 or 顧問（`coaches/{auth.uid}` 存在） or 連携済み LAB アカウント（`labLinks/{$uid}/labUid === auth.uid`）
- `lab/{$labUid}/declaration` は既存 `lab` ルールの範囲内（追加変更なし）
- 既存ルールテスト（14 本 PASS 中）に `declShared` の許可/拒否テストを追加してから deploy

## Phase 2: mental でマイプレイブック再現

- **新しい同期はゼロ**。mental は既に `lab/{labUid}/matchCards・gkPredictions・pvRecords` を読める（`getMyLabNode`）
- LAB の `app/src/components/playbook.jsx` の合成ロジック（試合カード＋GK 予測＋PV 記録 → プレイブック）を mental 側に移植し、「マイ統計」に「マイプレイブック」セクションを追加
- 表示のみ。編集機能は付けない（正本は LAB の元データ）
- 注意: LAB 側で合成ロジックを変更した場合は mental 側の移植コードも追従が必要。移植元ファイルと関数名を mental 側コードのコメントに明記する

## Phase 3: 顧問ダッシュボードに LAB 列

- 顧問ダッシュボード（`CoachDashboard`）の選手一覧に追加する情報:
  1. LAB 連携済みか（labLinks の有無）
  2. GK 予測・PV 記録の件数と最終記録日
  3. 宣言の内容と達成状況（LAB の `declaration` と mental の `declarations` 両方）
- ルール変更: 顧問（`coaches/{auth.uid}` 存在）は `lab/**` と `declShared/**` を **read のみ**可能に追加。書き込み権は一切広げない
- 顧問が labLinks を逆引きする必要があるため、`labLinks` の顧問 read 許可も確認（不足なら追加）

## 実装しないこと（YAGNI）

- mental から LAB 宣言へのチェック操作（双方向書き込み）
- 宣言スキーマの統一・共通化
- LAB からの mental 内面データ（reflections / izofRecords / nightLogs 等）へのアクセス
- プレイブックの mental 側編集

## リスクと対策

| リスク | 対策 |
|---|---|
| ルール変更ミスで内面データが漏れる | `users/{uid}/state` のルールは一切触らない。declShared のみ新設。ルールテスト追加後に deploy |
| ミラーの書き忘れで宣言が古いまま | state 保存関数に一元フック。updatedAt を表示側で見て「◯日前時点」を出す |
| LAB 未連携生徒でのエラー | 両アプリともカード非表示でフォールバック（既存の resolveLabUid null 処理を踏襲） |
| OneDrive 同期による作業ツリー破損 | コミット単位を小さく、push 前に `git status` 確認（既知の運用ルール） |

## デプロイ

- mental: git push（GitHub Pages が本番。firebase hosting は 302 転送のみ）＋ `firebase deploy --only database`（ルール変更時）
- LAB: handball-system を git push（GitHub Actions → GitHub Pages）

## 受け入れ確認（Phase 1）

1. 生徒端末: LAB で宣言を立てる → mental の宣言画面に「⚡プレーの宣言」が出る
2. 生徒端末: mental で宣言を立てる → LAB に「🧠 メンタルの宣言」が出る
3. 未連携の生徒: 両アプリともカードが出ない・エラーなし
4. 他生徒の declShared を読もうとすると PERMISSION_DENIED（ルールテストで確認）
