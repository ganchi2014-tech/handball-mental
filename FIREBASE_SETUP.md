# Firebase セットアップガイド（依頼主向け）

**所要時間**: 約30分（一度きり）  
**前提**: Googleアカウント（ganchi2014@gmail.com推奨）

---

## ステップ1: Firebase Console にアクセス

1. ブラウザで開く: https://console.firebase.google.com/
2. Googleアカウントでログイン
3. 「**プロジェクトを追加**」をクリック

## ステップ2: プロジェクト作成

1. プロジェクト名: `handball-mental`（または好きな名前）
2. 「続行」
3. **Google Analytics を有効化** ─ ☐ チェック**外す**（不要、シンプルに）
4. 「プロジェクトを作成」をクリック
5. 「新しいプロジェクトの準備ができました」が出たら「続行」

## ステップ3: Web アプリ登録

1. プロジェクトTOPで「**</>**（Web アイコン）」をクリック
2. アプリのニックネーム: `handball-mental-web`
3. 「**このアプリの Firebase Hosting も設定します**」 ☐ チェック**外す**（GitHub Pages使うため）
4. 「**アプリを登録**」をクリック
5. **`firebaseConfig` のコードが表示される** ← **これが超重要**

例：
```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "handball-mental.firebaseapp.com",
  projectId: "handball-mental",
  storageBucket: "handball-mental.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123def456"
};
```

**この `firebaseConfig` 全体をコピーして私に渡してください**。

「コンソールに進む」をクリック。

## ステップ4: Realtime Database 有効化

> ⚠ 本アプリは **Realtime Database（RTDB）** を使用します（旧版ドキュメントの Firestore 表記は誤り。実装は `firebase.database()` ＝ RTDB）。

1. 左メニュー「**構築**」→「**Realtime Database**」
2. 「**データベースを作成**」をクリック
3. ロケーション: **`asia-southeast1`（シンガポール）** を選択（本番と同一）
4. **「ロックモードで開始」** を選択（後でルールを貼る）
5. 「**有効にする**」をクリック

## ステップ5: Authentication 有効化

1. 左メニュー「**構築**」→「**Authentication**」
2. 「**始める**」をクリック
3. タブ「**Sign-in method**」→「**匿名**」を選択
4. 「**有効にする**」トグルON
5. 「**保存**」

## ステップ6: セキュリティルール（本番・厳格／要配慮個人情報の保護）

> ⚠ **「認証済みなら全アクセス可（`auth != null`）」は使わない**。それだと選手が他の選手のメンタルデータ（振り返り・IZOF・行動宣言・**セルフチェック**等の要配慮個人情報）を読めてしまい、保護者同意書【3】「他選手のデータは見られない」に反します。

1. Realtime Database → 「**ルール**」タブ
2. リポジトリの **[`database.rules.json`](./database.rules.json)** の `"rules"` の中身を**そのまま貼り付け**て「**公開**」。
   - 要点: `users/{uid}`（＝state配下の全データ。セルフチェック含む）は **本人 と 承認済み顧問（`/coaches/{uid}`）のみ read**、**本人のみ write**。`roster`/`matches` の書込みは承認顧問のみ。
3. `database.rules.json` をリポジトリの**正本**として管理し、ルールを変更したら必ずこのファイルも更新する（口頭の「厳格化済」ではなく、ファイルで証跡を残す）。

> セルフチェックのスコアは `users/{uid}/state.selfChecks` に保存されるため、上記 `users/{uid}` のルールで**追加設定なしに本人＋承認顧問のみ**に限定されます。

## ステップ7: ドメイン許可（GitHub Pages 用）

1. Authentication → 「**Settings**」タブ → 「**承認済みドメイン**」
2. 「**ドメインを追加**」をクリック
3. `ganchi2014-tech.github.io` を追加
4. 既存の `localhost` `127.0.0.1` はそのまま

## ステップ8: 設定完了の確認

最終的に、以下が完了していれば OK:

- [x] プロジェクト `handball-mental` 作成済
- [x] Webアプリ登録済（firebaseConfig 取得済）
- [x] Realtime Database 有効（asia-southeast1）＋ database.rules.json を公開
- [x] Authentication 匿名認証 有効
- [x] セキュリティルール公開済
- [x] `ganchi2014-tech.github.io` ドメイン許可済

## 私に渡すもの

**ステップ3 で出てきた `firebaseConfig` の中身（全コピペ）**

形式：
```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",       // ← この行から
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."               // ← この行まで全部
};
```

**※ apiKey は公開しても比較的安全**（RTDBルールで保護される）ですが、念のためチャットで共有してください。

---

## トラブルシューティング

### Q: 「プロジェクト名が使用できない」と表示される
A: `handball-mental-2026` など末尾に数字を付けて。

### Q: Firestore を本番環境モードで作ってルール書き換えたら「権限エラー」になる
A: ステップ6 のルール書き換えが正しく公開されているか確認。

### Q: ブラウザに「ドメインがホワイトリストに含まれていません」エラー
A: ステップ7 のドメイン許可を確認。

### Q: 「無料枠を超えそうで心配」
A: Sparkプラン（無料）は月5万読込・2万書込まで。20人チームなら何年もの運用に十分。

---

## 完了したら教えてください

`firebaseConfig` を渡してもらえれば、P2 (Firebase統合) フェーズで使用します。

P1 (localStorage版) は今すぐ開発開始するので、Firebase設定は並行で進めて大丈夫です。
