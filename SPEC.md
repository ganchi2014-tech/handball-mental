# メンタル統合機能 設計仕様書 v1.0

**作成**: 2026-06-04 AI開発組織  
**対象**: handball-system に統合する「メンタル」セクション  
**承認**: 依頼主（オーナー）

---

> ## ⚠ 実装ノート（2026-07-08 追記・最初に読む）
>
> 本書は当初設計であり、実装は以下の点で本書と**意図的に**異なる。読む際はこの差分を前提にすること。
>
> 1. **DBは Firestore ではなく Realtime Database（RTDB）**。§3 のコレクション設計・セキュリティルールは
>    当初案の記録として残すが、**現行の正本は `database.rules.json`**（このリポジトリ直下）。
>    実ノード: `users/{uid}/{state|gameStats|coachNotes|consultAck}` / `coaches` / `staff` /
>    `physicals/{uid}` / `team` / `roster` / `rosterToUid` / `matches` / `lab/{uid}` / `labShared` / `labLinks`。
> 2. **独立アプリとして構築**（§5-1 の方針転換どおり）。handball-system（LAB）とは Firebase プロジェクト
>    `handball-mental` を共有し、`/lab`・`/labShared`・`/labLinks`（UIDブリッジ）で連携する。
>    連携設計は `docs/superpowers/specs/2026-07-08-lab-bridge-design.md` を参照。
> 3. **名簿は「学年固定」でなく `enrollmentYear`（入学年）から学年を動的計算**。引退は削除でなく
>    `active=false`（引退フラグ）。設計は `docs/superpowers/specs/2026-07-08-retirement-roster-design.md`。
> 4. **PIN は v2 形式（SHA-256＋端末ランダムsalt・ローカル保存のみ）**。§4-1 の記述より強化済み。
>    旧v1形式の端末はログイン成功時に自動移行。
> 5. セットアップの正は `FIREBASE_SETUP.md`（RTDB前提で訂正済み）。

---

# 1. システム概要

## 1-1 全体構成

```
[handball-analyzer]              [handball-system + MENTAL]
試合中のリアルタイム入力             戦術ガイド + メンタル指導
- シュート記録                     - 戦術自己問答
- スタッツ集計                     - メンタル入力(新)
- CSV出力                          - 試合振り返り(新)
       │                                 │
       │ CSVエクスポート                  │
       │ または                           │
       └──→ Firebase Firestore ←─────────┘
                  │
                  ▼
            [顧問ダッシュボード]
            全選手データ管理
```

## 1-2 既存3アプリの役割

| アプリ | 役割 | データ | 連携 |
|---|---|---|---|
| **handball-analyzer** | 試合中のシュート記録 | localStorage | CSV経由でメンタルへ送信 |
| **handball-system** | 戦術ガイド+**メンタル統合**（拡張） | localStorage + Firebase | 中心HUB |
| ovelsesbanken-navigator | ノルウェー練習動画 | static JSON | 参照のみ（連携なし） |

---

# 2. メンタル機能の追加内容

## 2-1 新規追加するセクション

handball-system の既存ナビに「**メンタル**」タブを追加。中身は以下:

### A. 試合振り返り (アプリ最頻使用)
- 試合直後の入力（スマホで）
- handball-analyzer のCSVを取り込み紐付け可能
- IZOFチェック付き
- メンタル面の発見記録
- 蓄積を時系列で閲覧

### B. メンタルトレーニング日記
- 各セッション（49回）の内容閲覧
- セッション中・後の感想入力
- 行動宣言の進捗トラッキング
- 4週チェック表（デジタル）

### C. 自己評価
- 月1自己評価シート（デジタル）
- 練習意欲、メンタル状態、達成感
- 不調時の「相談したい」フラグ

### D. IZOF管理
- 試合前の状態入力
- ベスト/ワーストパターン蓄積
- 自分の型の経時変化

### E. 顧問ダッシュボード（顧問専用）
- 全選手の試合振り返り一覧
- 月1自己評価集約
- 「相談したい」フラグの即時通知
- 心の5つの力 セルフチェック（個人内の推移のみ。合計点・順位・選手間比較は出さない）

### F. セッション資料閲覧
- 49回のセッションスライド
- 顧問用台本（顧問のみ閲覧）
- ワーク提出

### G. **マイ統計（個人分析データ）** ★依頼主追加要望★

**問題提起**: 現状、handball-analyzer のデータは顧問の手元に集約されるだけで、**個々の選手に数値フィードバックが返らない**。これがフィードバック質を下げている。

**解決**: メンタルアプリに「マイ統計」を追加し、選手個人が自分の数値を閲覧できる仕組みを構築。

#### G-1 表示内容（各選手の個人画面）

**今日の試合**:
- ST試行数 / ゴール / セーブ / ミス
- シュートコース分布円グラフ（6方向）
- ミス理由内訳（パスミス・ドリブル・OFファール等）
- ST決定率・GKセーブ率（GKの場合）

**シーズン累積**:
- 累計ST試行・ゴール率・改善傾向グラフ
- ベスト試合 / ワースト試合
- ポジション別データ

**メンタル × 数値の相関**（高度機能）:
- 「自信5」の試合と「自信2」の試合のゴール率比較
- IZOF型別パフォーマンス傾向
- ベストパフォーマンス時の心理状態

#### G-2 顧問Dashboardからの配信フロー

```
[analyzer]
    │ 試合中の入力
    ▼
[CSV出力]（既存機能）
    │
    ▼
[顧問Dashboard 「CSVアップロード」]
    │ パース・選手紐付け
    ▼
[Firestore に個人別データ書込]
    │
    ▼
[選手が自分のマイ統計を見る]
    + メンタル振り返りと自動紐付け
```

#### G-3 配信プロセス（顧問操作）

1. 試合後、analyzer からCSV出力
2. メンタルアプリの顧問Dashboardで「CSVアップロード」
3. アプリが自動でパース、選手名・背番号で紐付け
4. プレビュー画面で確認（必要なら手動修正）
5. 「配信」ボタンで各選手に通知
6. 選手は通知から自分のマイ統計を見る

#### G-4 期待される効果

- **選手の自己分析力UP**: 数字で自分を見られる
- **メンタル振り返りの質向上**: 「自信なかった→ゴール率も低かった」等の相関に気づく
- **顧問の負担減**: 個別にデータを渡す作業が自動化
- **データ駆動の自己コーチング**が可能に

## 2-2 紙ベースとの関係

| 紙のもの | アプリ後 |
|---|---|
| 試合ノート | アプリで完全代替 |
| 月1自己評価シート | アプリで完全代替 |
| IZOFワークシート | Session 1の初回のみ紙、以降アプリ |
| 合言葉案出シート | Session 1の初回のみ紙 |
| 行動宣言シート | アプリで完全代替 |
| 保護者同意書 | 廃止（2026-06-11・保護者向け文書全廃） |

→ 全ての記入物がアプリ化。紙の保護者向け文書も全廃（2026-06-11）。

---

# 3. データモデル（Firestore）〔当初案・未採用。現行は RTDB — 冒頭の実装ノート参照〕

## 3-1 コレクション設計

```
firestore root/
├── teams/{teamId}
│   ├── name: "近江兄弟社高校男子ハンドボール部"
│   ├── coachId: "coach001"
│   ├── createdAt: timestamp
│   └── catchword: "やってきたこと出すぞ" (Session 1で決定)
│
├── players/{playerId}
│   ├── teamId: ref
│   ├── name: "選手名"
│   ├── grade: 2 (年生)
│   ├── position: "CB" | "GK" | "サイド" | "ピボット" | "バック"
│   ├── izofType: "中間型" | "低覚醒型" | "高覚醒型" (Session 1で発見)
│   ├── pinHash: "..." (簡易PIN認証用)
│   └── createdAt: timestamp
│   ※ 背番号は管理しない（全員に背番号があるとは限らないため）
│
├── reflections/{reflectionId}    ← 試合振り返り（最頻データ）
│   ├── playerId: ref
│   ├── gameId: ref → games/{gameId}     ← analyzer由来データへの参照
│   ├── gameDate: date
│   ├── opponent: "○○高校"
│   ├── result: "勝" | "負" | "引"
│   ├── selfScore: 7  (10点満点)
│   ├── bestPlay: text
│   ├── improvePlay: text
│   ├── mentalFinding: text
│   ├── nextTask: text
│   ├── coachWord: text  (監督の印象的な言葉)
│   ├── preGameIzof: { tension: 3, focus: 4, confidence: 3, condition: 4 }
│   └── createdAt: timestamp
│
├── games/{gameId}                ← 試合マスタ（analyzer由来）
│   ├── teamId: ref
│   ├── gameDate: date
│   ├── opponent: text
│   ├── result: "勝"|"負"|"引"
│   ├── teamScore: number
│   ├── opponentScore: number
│   ├── csvUploadedAt: timestamp
│   ├── uploadedBy: "coachId"
│   └── createdAt: timestamp
│
├── playerStats/{statId}          ← 選手個人試合スタッツ（★マイ統計のソース）
│   ├── playerId: ref
│   ├── gameId: ref
│   ├── gameDate: date
│   ├── stTries: 8                ← ST試行数
│   ├── goals: 5
│   ├── saves: 0
│   ├── misses: 3
│   ├── shotCourse: { 左上: 2, 右上: 1, 左中: 0, 右中: 1, 左下: 1, 右下: 3 }
│   ├── missReasons: { パスミス: 1, ドリブル: 1, OFファール: 1 }
│   ├── gkSavePercent: null       ← GKの場合のみ
│   ├── csvRawRow: text           ← オリジナルCSV行（監査用）
│   └── createdAt: timestamp
│
├── monthlyReviews/{reviewId}     ← 月1自己評価
│   ├── playerId: ref
│   ├── yearMonth: "2026-07"
│   ├── practiceMotivation: 8
│   ├── gameStateScore: 6
│   ├── mentalState: "良好" | "普通" | "不調気味" | "かなりつらい"
│   ├── achievements: [text, text, text]
│   ├── difficulties: text
│   ├── nextMonthGoal: text
│   ├── consultRequest: bool   ← 顧問への相談希望フラグ
│   ├── consultDetails: text   ← 相談内容
│   └── createdAt: timestamp
│
├── declarations/{declId}         ← 行動宣言（4週トラッカー）
│   ├── playerId: ref
│   ├── declaration: "寝る前10分のイメージ"
│   ├── startDate: date
│   ├── checks: [date, date, ...]  ← できた日の配列
│   └── reviewedAt: timestamp
│
├── sessionLogs/{logId}            ← メンタル指導日の感想
│   ├── playerId: ref
│   ├── sessionNumber: 1..49
│   ├── sessionDate: date
│   ├── insight: text             ← 今日の気づき
│   ├── feeling: text             ← 気持ち
│   ├── attended: bool            ← 出席（離席含む）
│   └── createdAt: timestamp
│
├── （※ users/{uid}/state.selfChecks[] に格納）  ← 心の5つの力セルフチェック（自作・自己採点）
│   ├── id / date / round: "baseline" | "midterm" | "final"
│   ├── items: [15]（各1-5）
│   ├── axisScores: { m1, m2, m3, m4, m5 }（各3-15。合計点は持たない＝序列化防止）
│   └── createdAt: timestamp
│   ※ 独立トップレベルパスにしない（単一state方式RTDB／本人＋承認顧問のみ閲覧の既存ルールに自動的に乗る）
│
└── sessions/{sessionNumber}       ← セッション資料マスタ（顧問のみ書込）
    ├── number: 1..49
    ├── date: date
    ├── theme: "キックオフ"
    ├── phase: 1..5
    ├── priority: "★★★" | "★★" | "★"
    ├── slidesUrl: "https://..."   ← スライドURL
    ├── scriptUrl: "https://..."   ← 台本URL（顧問のみ）
    ├── worksheets: [array]
    └── completed: bool             ← 実施済みフラグ
```

## 3-2 セキュリティルール (Firestore Security Rules)

```javascript
// 簡略版
match /databases/{database}/documents {
  // 選手は自分のデータのみ書込・読込
  match /reflections/{id} {
    allow read, write: if request.auth.uid == resource.data.playerId
                     || isCoach(request.auth.uid);
  }
  // 顧問は全選手のデータ閲覧可能
  match /players/{playerId} {
    allow read: if request.auth.uid == playerId || isCoach(request.auth.uid);
    allow write: if request.auth.uid == playerId;
  }
  // セッション資料は顧問のみ書込、選手は読込のみ
  match /sessions/{id} {
    allow read: if request.auth != null;
    allow write: if isCoach(request.auth.uid);
  }
}
```

---

# 4. 認証仕様

## 4-1 ログイン方式（簡易PIN）

```
[起動時]
   ↓
[既存ローカル保存あり?] ─ Yes ─→ [自動ログイン]
   ↓ No
[初回設定画面]
   ├─ 選手登録: 名前 / 学年 / 背番号 / ポジション
   └─ PIN設定: 4桁数字
   ↓
[2回目以降]
   └─ PINのみ入力

[顧問モード]
   └─ 別画面でコーチID + 専用PIN（管理者）
```

### 認証フロー詳細

- Firebase Anonymous Auth + カスタム文字列
- PINはハッシュ化（PBKDF2 or scrypt）してFirestoreに保存
- セッション維持: localStorage + idToken
- 「アカウント切替」機能（共用端末対応）

## 4-2 PINリセット手順

- 選手: 顧問が手動リセット
- 顧問: 別途リセット手順（管理者ロール）

---

# 5. UI設計

## 5-1 ナビゲーション

**重要決定**: handball-system 統合ではなく、**独立アプリ** `handball-mental` として構築。
- URL: `https://ganchi2014-tech.github.io/handball-mental/`
- handball-system は触らず安定運用継続
- handball-analyzer は触らず安定運用継続（CSV出力機能を活用）

### handball-mental のナビ（PWA）

選手モード:
- 🏠 ホーム（今日やること・通知）
- 📝 **試合振り返り**（マイ統計併設）
- 📈 **マイ統計**（分析データ）★ 依頼主追加要望
- 📅 **セッション**（49回内容＋セッションログ）
- 📊 自己評価（月1）
- 🎯 IZOF
- ✅ 行動宣言

顧問モード（別ログイン）:
- 📊 Dashboard（全選手一覧・相談希望通知）
- 📤 **CSV配信**（analyzerデータ取込→各選手に配信）★ 依頼主追加要望
- 📅 セッション管理
- ⚙️ チーム設定

## 5-2 主要画面のワイヤー

### 試合振り返り入力画面

```
┌─────────────────────────┐
│ 試合振り返り 新規作成        │
├─────────────────────────┤
│ 試合日: [2026/11/10]      │
│ 相手:  [_______________]   │
│ 結果:  ● 勝 ○ 負 ○ 引     │
│                            │
│ 自分の調子: [⭐⭐⭐⭐⭐⭐⭐☆☆☆] 7  │
│                            │
│ ベストプレー1つ:           │
│ [_______________________]  │
│                            │
│ 改善したい1つ:             │
│ [_______________________]  │
│                            │
│ メンタル面の発見:          │
│ [_______________________]  │
│                            │
│ 次回課題1つ:               │
│ [_______________________]  │
│                            │
│ 監督の言葉:                │
│ [_______________________]  │
│                            │
│ 試合前のIZOF:              │
│  緊張度: ○●○○○ 2          │
│  集中度: ○○●○○ 3          │
│  自信:   ○○○●○ 4          │
│  体調:   ○○○○● 5          │
│                            │
│ analyzer連携: [CSV添付] 📎  │
│                            │
│      [保存]    [キャンセル] │
└─────────────────────────┘
```

### 顧問ダッシュボード

```
┌─────────────────────────┐
│ 顧問ダッシュボード          │
├─────────────────────────┤
│ ⚠ 相談希望 [3件]            │
│  - 田中(2年): 詳細→         │
│  - 鈴木(1年): 詳細→         │
│                            │
│ 最近の試合振り返り:         │
│  11/10 vs A高 [全12名提出済]│
│  11/03 vs B高 [全12名提出済]│
│                            │
│ 月1自己評価提出率:          │
│  11月: 10/12 ▓▓▓▓▓▓▓▓▓▓░░ │
│                            │
│ メンタル状態分布(11月):     │
│  良好:5 普通:4 不調:2 つらい:1│
│                            │
│ セルフチェック5軸推移 ▼     │
└─────────────────────────┘
```

---

# 6. handball-analyzer 連携 ★ 強化版（マイ統計対応）

## 6-1 CSV取り込み＋個人配信フロー

```
[handball-analyzer]
   試合中・直後に顧問が入力
   ↓
[CSVエクスポート]
   "全試合まとめてCSV" ボタン（既存機能）
   ↓
[handball-mental の 顧問CSV配信画面]
   1. CSVファイル選択
   2. 自動パース（試合日・相手・各選手スタッツ）
   3. 選手名/背番号で playerId にマッチング
   4. プレビュー: 「12名分のデータが取込まれます」
   5. 必要なら手動修正
   6. [配信] ボタン押下
   ↓
[Firestore]
   - games/{gameId} に試合マスタ作成
   - playerStats/{statId} に各選手のスタッツ書込
   - 既存 reflections/{rId} と gameId で紐付け
   ↓
[各選手のスマホに通知]
   "新しい試合データが届きました [vs A高 11/10]"
   ↓
[選手のマイ統計画面]
   - 試合別の個人スタッツ表示
   - 振り返り入力時にスタッツ自動併記
   - 累計データ更新
```

## 6-2 CSV フォーマット仮想例

handball-analyzer のCSV出力フォーマット（推定）:
```csv
試合日,相手,試合結果,自スコア,相手スコア,選手名,背番号,ポジション,ST試行,ゴール,セーブ,ミス,シュート左上,シュート右上,シュート左中,シュート右中,シュート左下,シュート右下,ミス_パス,ミス_ドリブル,ミス_OF
2026-11-10,A高,勝,28,25,田中太郎,7,CB,8,5,0,3,2,1,0,1,1,3,1,1,1
2026-11-10,A高,勝,鈴木次郎,9,LW,6,4,0,2,1,2,1,0,1,1,0,1,1
...
```

**実装ステップ**:
1. 実際の handball-analyzer の CSV を1つもらってフォーマット確定
2. パーサー実装
3. テスト

## 6-3 マッチング戦略

選手名で照合（背番号はチーム管理外のため使わない）:
1. 名前完全一致: 即マッチ
2. 名前部分一致（カタカナ・漢字違いの可能性等）: 候補表示→顧問確認
3. 未一致: 「新規選手として登録？」プロンプト

※ analyzer CSV に背番号列が含まれる場合は記録としては保持するが、選手マッチングには使わない

## 6-4 配信前プレビュー画面

```
┌─────────────────────────┐
│ CSV配信プレビュー           │
├─────────────────────────┤
│ 試合: 2026-11-10 vs A高 (勝)│
│                            │
│ 配信対象選手: 12名          │
│  ✓ 田中太郎(7) CB           │
│  ✓ 鈴木次郎(9) LW           │
│  ✓ 山田三郎(11) GK          │
│  ⚠ 高橋四郎(13) ← 未登録選手 │
│   [→ 新規登録] [→ スキップ]  │
│  ...                        │
│                            │
│ 配信されるデータ:           │
│  - 各選手の試合スタッツ     │
│  - 試合マスタ情報           │
│                            │
│ 配信後:                     │
│  - 各選手に通知が届く       │
│  - マイ統計に反映される     │
│                            │
│   [キャンセル] [配信実行]   │
└─────────────────────────┘
```

## 6-5 マイ統計UI（選手側）

```
┌─────────────────────────┐
│ マイ統計 - 田中太郎        │
├─────────────────────────┤
│ 📊 今日の試合 (11/10 vs A高)│
│  ST試行: 8                 │
│  ゴール: 5  決定率: 62%    │
│  ミス:   3  ミス率: 38%    │
│                            │
│ シュートコース分布:         │
│  ┌──┬──┬──┐              │
│  │左上│右上│左中│         │
│  │ 2 │ 1 │ 0 │             │
│  ├──┼──┼──┤              │
│  │右中│左下│右下│         │
│  │ 1 │ 1 │ 3 │             │
│  └──┴──┴──┘              │
│  → 右下が得意（37.5%）      │
│                            │
│ 📈 シーズン累積 (11月時点)  │
│  累計ST: 56  累計ゴール: 31 │
│  シーズン決定率: 55%        │
│  推移: ↗ 改善中             │
│                            │
│ 🧠 メンタル × 数値          │
│  自信5の試合: 平均決定率68% │
│  自信2の試合: 平均決定率41% │
│  → 自信を上げる工夫が必要   │
│                            │
│   [振り返りを書く] →        │
└─────────────────────────┘
```

## 6-6 将来的にFirestore直接統合

Stage 3 として、handball-analyzer 側も Firebase 対応に拡張し、CSV経由ではなくリアルタイム同期に。今回スコープは CSV取込＋配信まで。

---

# 7. 開発フェーズ

## P1: 基本MVP（最優先）

**期間**: 1-2セッション
**範囲**:
- handball-system に「メンタル」タブ追加
- 試合振り返り入力＋一覧表示
- 月1自己評価入力＋一覧
- 行動宣言＋4週トラッカー
- IZOF入力＋履歴
- **localStorageに保存**（個人ローカル）
- 顧問ダッシュボードは P2 で

## P2: Firebase統合・複数人運用

**期間**: 2-3セッション
**範囲**:
- Firebase Firestore セットアップ
- 認証 (簡易PIN)
- データ同期
- 顧問ダッシュボード
- セキュリティルール

## P3: handball-analyzer連携

**期間**: 1セッション
**範囲**:
- CSV取り込み機能
- 試合振り返りへの自動紐付け
- スタッツ閲覧

## P4: セッション資料閲覧

**期間**: 2-3セッション
**範囲**:
- 49セッションの内容をアプリ内表示
- スライドのWeb化（HTML or PDF表示）
- ワーク提出機能
- 顧問用台本（顧問のみ閲覧）

## P5: 追加機能

**期間**: 後追い
**範囲**:
- 呼吸法タイマー（2-3-15/4-7-8/ボックス）
- イメージング誘導音声
- プッシュ通知（次セッション・行動宣言リマインド）
- 心の5つの力 セルフチェック（自作・自己採点・5軸バー／**実装済**：マイ統計内・users/{uid}/state.selfChecks）

---

# 8. 技術スタック

## 8-1 フロントエンド

- **既存handball-systemに合わせる**: React 18 (via CDN) + Babel standalone
- 単一index.htmlに追記（既存方式踏襲）
- CSS in JS (既存のGlass Athletic Design System活用)

## 8-2 バックエンド

- **Firebase Firestore** (NoSQL、リアルタイム同期、無料枠十分)
- **Firebase Authentication** (Anonymous Auth + PIN)
- **Firebase Hosting** または GitHub Pages 継続
- **Firebase Storage** (任意：将来のCSVアップロード用)

## 8-3 開発ツール

- Firebase CLI (firebase-tools)
- ローカルテスト: `firebase emulators:start`
- デプロイ: `firebase deploy` または GitHub Actions

## 8-4 セキュリティ・プライバシー

- PIN は PBKDF2 でハッシュ化（クライアントサイド）
- Firestore Security Rules で他選手データへのアクセス禁止
- 顧問のみ全データ閲覧可能
- 卒業時にデータ削除機能（管理者）
- 個人情報最小化（実名でも背番号でも可）

---

# 9. デプロイ＆運用

## 9-1 ホスティング

- **継続: GitHub Pages** (handball-system)
- URL: https://ganchi2014-tech.github.io/handball-system/
- メンタルタブは同一URL内のSPA内ルーティング

## 9-2 コスト

- Firebase Spark プラン（無料枠）:
  - Firestore: 月5万読込・2万書込・1GB
  - 認証: 月3万人まで無料
- 15-25人のチームなら数年無料で運用可能

## 9-3 バックアップ

- Firestore 自動エクスポート設定（Cloud Scheduler）
- CSV手動エクスポート機能（顧問ダッシュボード）

## 9-4 学校との確認事項

- 個人情報保護方針の保護者説明
- 学校PCポリシーとの整合
- GIGA端末（タブレット）対応の確認

---

# 10. P1で着手する具体作業

## ステップ1: handball-system index.html の構造分析

- 既存タブ・ルーティング・コンポーネント構造の把握
- スタイル変数の把握

## ステップ2: メンタルセクション設計

- 「メンタル」タブを追加するコード設計
- localStorage スキーマ設計（P2でFirestoreに移行しやすい構造に）

## ステップ3: 試合振り返り機能を実装

- 入力フォーム
- 一覧表示
- localStorage 保存

## ステップ4: 他機能（月1評価・IZOF・行動宣言）追加

- 同パターンで実装

## ステップ5: 顧問モード（簡易版）

- 顧問専用URLでlocalStorage直接読み（複数選手データは P2 で）

---

# 11. 確認事項

依頼主に最終確認:

1. ☐ 仕様内容で問題ないか
2. ☐ Firebase アカウント作成は私が代行する？それとも依頼主が作成？
3. ☐ GitHub リポジトリへのコミット権限（既存ganchi2014-techリポへ）
4. ☐ 学校との合意（個人情報・保護者）は依頼主側で確認済？
5. ☐ アプリ名: "HANDBALL LAB Mental" / "メンタルLAB" / 他？
6. ☐ デプロイ先: GitHub Pages継続 OR Firebase Hosting？

---

# 12. 次のアクション

1. **本仕様書のレビュー**（依頼主）
2. 承認後、**P1実装開始**
3. P1完成後、依頼主が動作確認
4. OK なら P2 へ

---

**作成**: 2026-06-04  
**承認待ち**: 依頼主
