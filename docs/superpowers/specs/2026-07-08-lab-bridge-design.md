# Phase B-1: UIDブリッジ（/labLinks）＋マイ統計LABコーナー 設計 — 2026-07-08

オーナー承認済み（2026-07-08）。オーバーホール Phase B の第1段。

## 背景（発見した欠陥）

mental（handball-mental.web.app）と LAB（ganchi2014-tech.github.io）は別オリジンのため、
Firebase 匿名認証の uid は端末・ブラウザが同じでも**必ず別々**に発行される。
LAB は `/lab/{LABuid}/` に書き、mental の読み的中率タイルは `/lab/{mentalUid}/` を読むため、
現状このタイルが表示される端末は事実上存在しない（「データなし→非表示」仕様が欠陥を隠していた）。
LAB 接続画面の「同じブラウザで開くとつながる」案内も実際には機能しない。

## 設計

### 1. 新ノード /labLinks（database.rules.json — mental リポが正本）

```
/labLinks/{mentalUid} = { labUid: string, rosterId: string, updatedAt: number }
```

- **意味**: 「mentalUid の選手の LAB 記録は lab/{labUid} にある」という選手発意の公開宣言。
- **write**: `auth.uid === newData.labUid`（自分の labUid しか名乗れない）
  かつ 上書きは既存 labUid 本人のみ（先取り後の乗っ取り防止）。
  削除は labUid 本人 または mentalUid 本人（連携解除用）。
- **rosterToUid との突合は mental クライアント側で行う**（link.rosterId を読み
  `rosterToUid[link.rosterId] === 自uid` を確認してから labUid を採用）。
  ルール内突合にしない理由: verify スクリプトが /rosterToUid に書けない制約
  （破壊防止・絶対禁止）のため ALLOW 側を本番検証できない。攻撃者は被害者の実 rosterId を
  使えばルール内突合も通過できるため、防御力は client 検証と等価。実防御は
  labUid=auth.uid 強制＋上書き保護＋mental 側突合の3点。
- **read**: `auth.uid === $mentalUid || auth.uid === data.labUid`（本人たちのみ）。
- **/rosterToUid の read-only 制約（LAB憲法）は不変。**

### 2. /lab/{uid} read ルール拡張

```
".read": "auth != null && ($uid === auth.uid ||
          root.child('labLinks').child(auth.uid).child('labUid').val() === $uid)"
```

write は従来どおり本人のみ。mental はブリッジ登録済みの場合のみ選手本人として LAB 記録を読める。

### 3. LAB 側（handball-system）

- `fb.js` に `fbWriteLabLink(mentalUid, rosterId)` を追加（`labLinks/{mentalUid}` へ set。
  rosterToUid には触れない）。
- `App.jsx` の `handlePickRoster`: 名簿から自分を選んだとき `fbCheckRosterLink` の
  `linkedUid` が存在すれば `fbWriteLabLink(linkedUid, rosterId)` を実行。
  成功 → notice `bridged`（「✓ メンタルのマイ統計にLABの記録が出ます」）。
  失敗 → 従来の mismatch 系文言（実態に合わせ更新: 「同じブラウザで〜」の効かない案内を削除）。
- 選手が名簿の自分をタップする操作＝連携の意思表示（接続パネルに効果を明記済み）。

### 4. mental 側（index.html）

- `storage.getMyLabNode(authUid, node)`: `labLinks/{authUid}` から labUid を解決
  （なければ authUid にフォールバック）→ `lab/{labUid}/{node}` を一回読み。
  既存 `getMyLabCards` はこれ経由に変更（読み的中率タイルの修理）。
- マイ統計に **LABコーナー**（section-h「LAB連携」）:
  - 🔮 読み的中率（既存タイル移設）
  - 🧤 GK予測: 丸付け済み件数と的中率（`gkPredictions` の `hit === true/false` を集計）
  - 🎯 PV認知: 記録件数（`pvRecords` の件数。直近日付があれば添える）
  - いずれも データなし/読取不可 → 非表示（従来仕様を維持）
  - コーナー末尾に「LABを開く →」外部リンク
- ホームのクイックアクションに「🧪 HANDBALL LAB」タイル（外部リンク・新規タブ）。
- 起動時の名簿選択: 未認証・名簿未受信の間は「名簿がまだありません」ではなく
  「読み込み中…」を表示（誤解の修正）。

### 5. 検証

- LAB: `.scripts/verify-lab-rules.mjs` に labLinks マトリクスを追加
  （本番ルールデプロイ後に実行する既存方式。/labLinks はデプロイ時点で空なので安全）:
  1. labUid 本人・rosterToUid 突合一致で create → ALLOW
  2. rosterToUid 突合不一致 → DENY
  3. labUid 他人なりすまし（newData.labUid ≠ auth.uid）→ DENY
  4. 既存エントリを別 labUid が上書き → DENY ／ 同一 labUid 更新 → ALLOW
  5. mentalUid 本人 read → ALLOW ／ 無関係の第三者 read → DENY
  6. ブリッジ経由 /lab/{labUid} read（labLinks 登録済 mentalUid）→ ALLOW
  7. 未登録 uid からの /lab/{labUid} read → DENY
  8. mentalUid 本人による削除 → ALLOW
- LAB: Vitest 全緑（新規純関数があればテスト追加）。
- mental: ローカルサーバー起動でコンソールエラーなし＋Babel コンパイル成功。
- 本番反映（rules デプロイ→verify実行→hosting/LAB デプロイ）は改めてオーナー承認。

### やらないこと

- rosterToUid への書込 API 追加（絶対禁止・不変）
- LAB に顧問向け集計ビュー（LAB憲法1）
- 案2（試合ループ同期）— 本ブリッジの上に次段で設計
