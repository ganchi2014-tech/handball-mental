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

## ステップ4: Firestore Database 有効化

1. 左メニュー「**構築**」→「**Firestore Database**」
2. 「**データベースの作成**」をクリック
3. **「本番環境モードで開始」** を選択（推奨）
4. ロケーション: **`asia-northeast1`（東京）** を選択
5. 「**有効にする**」をクリック
6. 数分待つ

## ステップ5: Authentication 有効化

1. 左メニュー「**構築**」→「**Authentication**」
2. 「**始める**」をクリック
3. タブ「**Sign-in method**」→「**匿名**」を選択
4. 「**有効にする**」トグルON
5. 「**保存**」

## ステップ6: セキュリティルール（仮設定）

1. Firestore Database → 「**ルール**」タブ
2. 以下に書き換え（とりあえず開発用、後で厳格化）：

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      // 開発中: 認証済みなら全アクセス可。本番化前に厳格化必須
      allow read, write: if request.auth != null;
    }
  }
}
```

3. 「**公開**」をクリック

## ステップ7: ドメイン許可（GitHub Pages 用）

1. Authentication → 「**Settings**」タブ → 「**承認済みドメイン**」
2. 「**ドメインを追加**」をクリック
3. `ganchi2014-tech.github.io` を追加
4. 既存の `localhost` `127.0.0.1` はそのまま

## ステップ8: 設定完了の確認

最終的に、以下が完了していれば OK:

- [x] プロジェクト `handball-mental` 作成済
- [x] Webアプリ登録済（firebaseConfig 取得済）
- [x] Firestore Database 有効（東京リージョン）
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

**※ apiKey は公開しても比較的安全**（Firestoreルールで保護される）ですが、念のためチャットで共有してください。

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
