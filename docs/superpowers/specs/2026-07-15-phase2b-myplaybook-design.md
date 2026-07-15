# Phase 2B: マイ統計 → マイプレイブック（統合表示・穴埋め①②③）設計書

日付: 2026-07-15
状態: 設計承認済み・実装前
前提: Phase 1（宣言相互乗り入れ）本番反映済み。labLinks × rosterToUid の橋が稼働中。

## 背景と全体像

選手のタスクが2アプリに散らばっている問題を解くため、**mental を選手の母艦**とし、LAB は「mental がやらない戦術/技術の専門作業」に絞る方針を決定した（オーナー決裁 2026-07-15）。

全体フェーズ分解（各フェーズ独立して出荷可能）:
- **Phase 2B（本設計書）**: mental の「マイ統計」を「マイプレイブック」に育てる。全データを1画面で見返せるようにする。**足し算・低リスク**
- **Phase 2A（次・夏休み中）**: LAB から「宣言」「5分振り返り」の入口を畳み、mental に一本化。LAB は読み宣言・丸付け・GK・PV・課題・練習の専門ツールに。データは保全（引き算・要注意）
- **Phase 2C（最後）**: mental ホームを「今日やること1本道」に。動線統合（大）

新・選手の動線: 「ふだんは mental だけ／試合前後だけ LAB」。mental のプレイブックが LAB の戦術データも吸い上げて見せる。

## Phase 2B の目的

mental の `MyStats` コンポーネント（`index.html` 4952行〜、ナビ 'stats'・ラベル「マイ統計」）は既に多くを集約している:
- 心の5つの力（selfChecks）／フィジカル（physicals）／予防・負荷・同意
- LAB連携: 読み的中率・GK予測的中率・PV認知件数（橋で読取済み）
- 試合データ（gameStats・`aggregateGameStats`）

まだ入っていない"統合の穴"のうち、**①②③を今回埋める**（④⑤は次点として本書に記録）。

**新しい Firebase 同期・ルール変更は一切不要。** データは全て「mental 自身の state」か「Phase 1 の橋（getMyLabNode）で既に読めるもの」。

## 実装スコープ（①②③＋要約カード）

対象は `MyStats` コンポーネント1つ（+ 必要なら小さな純関数を近傍に追加）。

### ① 行動宣言タイル
- データ: `state.declarations`（mental 自身のローカル state・即読める）
- 表示: 進行中の宣言テキスト・チェック日数・完了した宣言数・達成率（完了数/全体）
- 進行中も完了もなければ「まだ宣言なし」＋宣言画面へのリンク（`onNav('declaration')`）

### ② 振り返りタイル
- データ: `state.reflections`（ローカル）
- 表示: 累計本数・最後に書いた日・直近3件の日付/一言（あれば）。「振り返りを書く→」（既存 `onWriteReflection`）
- 0件なら「まだ振り返りなし」＋導線

### ③ 課題タイル（LAB）
- データ: `storage.getMyLabNode(authUid, 'tbTasks')`（橋で読取・一回読み）
- 表示: LABの課題件数・最近のタイトル数件。「LABで課題を作る→」（LAB を別タブで開く。既存 LAB連携コーナーの `window.open` と同じURL）
- 読めない/未連携/0件なら**タイル非表示**（既存 LAB連携コーナーと同じ「読めなければ非表示が正」作法）

### 要約カード「🗂 あなたの積み上げ」（見やすく並べ直す部分）
- `MyStats` の**先頭**に1枚。以下を1行ずつ集約表示:
  - 宣言: 達成◯件／進行中◯件
  - 振り返り: 累計◯本
  - 読み的中率: ◯%（既存 `yomiStat` を再利用）
  - 課題: ◯件（③のデータを再利用）
- LAB由来の行（読み的中率・課題）は、読めない場合その行だけ省く（カード自体は宣言・振り返りがあるので出る）
- 目的: 「散らばり感」を1枚に集約して解消。LAB側プレイブック（`playbook.jsx` ①サマリー）と同じ発想

## データフローと二度読み防止

- 既存 `MyStats` の LAB 読み取り `useEffect`（4992〜5026行）は `getMyLabCards`（読み）・`getMyLabNode('gkPredictions')`・`getMyLabNode('pvRecords')` を叩いている。**③の tbTasks 読み取りをこの同じ useEffect に相乗り**させ、`tbStat` state を1つ足す（新しい useEffect を増やさない）
- 要約カードは既存 state（`yomiStat`・新 `tbStat`）と `state.declarations`/`state.reflections` から算出。**同じノードを二度読みしない**

## 触らないもの（YAGNI・回帰防止）

- 既存の心の5つの力・フィジカル・予防/負荷/同意・LAB連携コーナー・試合データ表示はそのまま
- `aggregateGameStats`・`saveCloud` debounce・`users/{uid}/state` の保存経路は変更しない
- ナビのラベル「マイ統計」は据え置き（"プレイブック"改名は動線を変える Phase 2C で検討）。混乱回避
- LAB リポジトリには一切手を入れない（Phase 2B は mental のみ）

## エラー処理

- LAB 由来の読み取りは既存パターン踏襲: `.catch(e => { console.debug(...); setXxx(null); })`、未連携・権限拒否でも mental 自身のデータ（①②・要約の宣言/振り返り行）は表示される
- `state.declarations`/`state.reflections` が undefined でも `|| []` で防御

## テスト・検証

mental は単一 HTML・ユニットテスト機構なし。検証はローカル起動＋実ブラウザ:
1. `preview_start`（launch.json の "mental"）でローカル起動
2. 選手アカウントで「マイ統計」を開く
3. 要約カード「🗂 あなたの積み上げ」・①宣言・②振り返りタイルが表示される（宣言/振り返りが空でも導線が出る）
4. コンソールに debug 以外のエラーがない
5. LAB未連携でも白画面にならず、①②は出て③とLAB行は非表示

## 受け入れ確認

1. 宣言・振り返りがあるアカウントで、要約カードに件数が正しく出る
2. LAB連携済みなら、③課題タイルと要約の「読み的中率・課題」行が出る
3. LAB未連携でも①②と要約（宣言・振り返り行）が出て、エラーなし

## 次点（④⑤・本フェーズ外・将来 Phase 2B-2 で回収）

- ④ 推移グラフ: GK的中率・PV②③率の週次トレンド（LAB `playbook.jsx` の `gkWeeklySeries`/`pvSeries` 相当を mental に移植）
- ⑤ 効いた技: LAB で⭐したカードの「良かった点」（`matchCards` の star＋RESULTS 参照。RESULTS コンテンツを mental が持たないため移植方法の検討が必要）

## デプロイ

- mental: git push（GitHub Pages 本番反映）。ルール変更なしなので `firebase deploy` 不要
- オーナー承認後に push
