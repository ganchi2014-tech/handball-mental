# 顧問PINログイン（端末をまたぐ顧問承認） 設計書（2026-07-12）

## 問題

顧問の実権限は `/coaches/{匿名uid}` の存在で判定される（Firebase Console 手動登録）。
匿名認証のuidは端末ごとに変わるため、顧問が別端末・別ブラウザで開くたびに
Console でのID登録が必要になっている。ログインPIN（4桁）は端末内の補助錠であり権限と無関係。

## 決定（オーナー承認済み）

個人別の**顧問PIN（6桁）**を導入し、承認済み顧問の一覧から自分を選んで
PINを入力すれば新しい端末でも自己承認できるようにする。Console手動登録も併存（後方互換）。

## データ設計（RTDB）

| ノード | 内容 | read | write |
|---|---|---|---|
| `/coachNames/{coachId}` | 表示名（文字列） | auth必須 | 顧問のみ |
| `/coachPins/{coachId}` | 顧問PINのハッシュ `c1:hex` | **不可**（ルール比較専用） | 顧問のみ |
| `/coachClaims/{uid}` | `{coachId, pinHash, at}` 自己承認の申告 | 不可 | 本人のみ（削除は顧問も可） |
| `/coaches/{uid}` | 既存。値は `true`（Console手動）または `coachId`（PIN自己承認） | auth必須（既存どおり） | 本人=claim済coachIdのみ／顧問=削除のみ |

**PIN検証はすべてFirebaseルール側**で行う：
- `/coachClaims/{uid}` の `.validate` が「`pinHash` が文字列であり、`/coachPins/{coachId}` の値と完全一致」を要求。
  PINが違えば書込自体が拒否される。`pinHash.isString()` 必須（null === null による素通り防止）。
- `/coaches/{uid}` の本人書込は「値 = 自分のclaimの `coachId`」のみ許可。claimが無ければ書けない。

ハッシュは端末間で一致が必要なため**固定salt**の SHA-256（`hashCoachPin`、形式 `c1:hex`）。
`coachPins` は読み取り不可なのでオフライン総当たりは不可。オンライン総当たりは
書込試行のたびにネットワーク往復が必要で、6桁（100万通り）を前提に許容する（部活アプリの脅威モデル）。
既存の4桁端末PIN（`hashPinV2`・端末ローカル）はそのまま。

## フロー

1. **登録（ブートストラップ）**: 承認済み端末の顧問Dashboard「👤 顧問リスト」で
   名前＋顧問PIN(6桁) を登録（`coachNames`＋`coachPins` へ書込）。PIN変更・削除も同画面。
2. **新端末ログイン**: ログイン「顧問・コーチ」画面に「登録済み顧問でログイン」を追加。
   一覧（coachNames）から選択 → 顧問PIN入力 → `hashCoachPin` → `/coachClaims/{uid}` 書込
   →（ルール通過＝PIN正解）→ `/coaches/{uid} = coachId` 書込 → 承認済みとして即開始。
   端末PINには同じ6桁を `hashPinV2` で保存（入力1回で済ませる）。
   書込拒否（permission denied）時は「PINが違います」。
3. **端末の解除**: 顧問リスト画面に「承認済み端末一覧」（`/coaches` の値がcoachIdの項目）を表示し、
   顧問が任意の端末uidを解除できる（自分の最後の1台を消す時は警告。Console登録が最終復旧手段）。
4. **PIN変更は端末の失効ではない**: 承認済み端末は claim ベースで有効なまま。紛失・不正端末の
   無効化は「承認済み端末一覧」からの解除（coaches＋coachClaims の同時削除）で行う。

## 対象外（YAGNI）

- staff（マネージャー）への同方式の展開は今回見送り（必要になったら同型で追加）。
- PINリセットの自動フロー（忘れた場合は他の顧問が再登録 or Console）。
- レート制限・試行回数制限（脅威モデル上不要と判断。必要なら claims に試行記録を足す設計余地あり）。
