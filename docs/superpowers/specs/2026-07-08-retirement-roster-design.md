# 3年生引退対応（引退フラグ方式）設計 — 2026-07-08

オーナー承認済み方針: 完全削除ではなく `active=false`（引退フラグ）で名簿・選手選択から非表示にし、
過去の試合データ・フィジカル記録・統計・rosterToUid 連携は無傷で残す。

## 対象3年生（10名）

赤塚・岩噌・川崎・北村・辻・中田・伴・山本・桑原(GK)・杉本(GK)
※ 岩噌は1年にも同姓の別人がいるため、除くのは3年（enrollmentYear=2024）のみ。

## 変更点

### handball-mental / index.html

1. `makeDefaultRosterEntries()`（旧32名）から3年の行を除去 → **既定22名（2年10名＋1年12名）**。
   gkSet から 桑原・杉本 を除去。UI文言の「32名」は既定リスト長から動的表示に変更。
2. `RosterManagement.save()` が常に `active: true` を書いていたバグを修正
   （引退選手を編集すると無言で復帰してしまう）→ 編集前の active を保持。
3. 名簿管理画面:
   - 「🎓 3年生を一括引退」ボタン（現役の grade=3 がいる時のみ表示、confirm 付き、
     各エントリへ `update({active:false})`）。
   - 「引退選手を表示」トグル → 引退リスト（各行に「復帰」ボタン）。
   - 選手編集モーダルに「引退にする」ボタン（削除の非破壊代替。運用ガイド文言も更新）。

### handball-mental / handball-analyzer/lib/roster.js

- `DEFAULT_PLAYER_NAMES` から③の10名を除去（32→22名）。
- `DEFAULT_GKS_SHORT` から 桑原・杉本 を除去。
- `tests/roster.test.js` の 32名前提を 22名に更新。
- Firebase 同期側（loadFromFirebase / subscribeFirebase）は既に `active !== false` を
  除外済みのため変更不要。

### handball-system（HANDBALL LAB）/ app/src/lib/fb.js

- `fbNormalizeRoster()` が `active === false` のエントリを除外していない穴を修正
  （mental で引退にしても LAB の選手チップに残り続けるため）。
- `tests/fb.test.js` に引退除外のテストを追加（TDD: 先に赤→修正→緑）。

## 変更しないもの

- Firebase 本番 `/roster` の実データ（顧問がデプロイ後に「3年生を一括引退」を1タップで反映）。
- `/rosterToUid` の連携（引退後も選手本人の過去記録閲覧を妨げない。書込禁止制約も不変）。
- 学年計算ロジック（enrollmentYear 方式のまま。引退者は active で隠れるため
  来年度の grade=4 表示問題は顕在化しない）。

## 検証

- analyzer: `node tests/runner.js`（既存テストランナー）全緑。
- LAB: `npm test`（Vitest）全緑。
- mental: 単一HTMLのためローカルサーバーで起動しコンソールエラーなし・名簿管理UIの動作確認。
- main への push / 本番反映はオーナー承認後。
