# Project Name


## デプロイ

1. 初期セットアップ
```bash
# 必要なパッケージのインストール
sudo dnf update -y
sudo dnf install -y git nodejs npm

# pm2のグローバルインストール
sudo npm install -g pm2

# アプリケーションディレクトリの作成
sudo mkdir -p /home/ec2-user/app
sudo chown -R ec2-user:ec2-user /home/ec2-user/app
```

2. アプリケーションのデプロイ
```bash
# Git Clone
cd /home/ec2-user/app
git clone https://github.com/kurosawa-kuro/infra-devcontainer-aws-cdk-cicd-nodejs.git .

# 依存関係のインストール
npm install --production

# 環境変数の設定
cp .env.example .env
vim .env  # 環境変数を設定
```

3. pm2での起動
```bash
# pm2設定と起動
cd /home/ec2-user/app
pm2 start app.js --name "express-app"

# pm2の自動起動設定
pm2 startup
pm2 save
```

## ライセンス

![image](https://github.com/user-attachments/assets/7c5bea60-d337-4a76-8ebd-dc6ee304778f)

# アプリケーション仕様書

# ソーシャルメディアプラットフォーム仕様書

## 1. システム概要

本システムは、ユーザーが投稿を共有し、交流できるソーシャルメディアプラットフォームです。画像付きの投稿、フォロー関係の構築、いいねやコメントによる交流、カテゴリ分類などの機能を提供します。

## 2. 主要機能

### 2.1 ユーザー管理機能

#### ユーザー登録
- メールアドレス、パスワード、ユーザー名による登録
- ユーザー名は半角英数字のみ許可
- パスワードは安全なハッシュ化を実施

#### プロフィール管理
- プロフィール画像のアップロード
- プロフィール情報の編集（自己紹介、場所、ウェブサイト、生年月日）
- ユーザー名の変更機能

#### 認証・認可
- メールアドレスとパスワードによるログイン
- セッション管理によるログイン状態の維持
- ロールベースの権限管理（一般ユーザー、管理者、閲覧専用管理者）

### 2.2 投稿機能

#### 投稿作成
- テキストによる投稿
- 画像のアップロード（JPEG、PNG、GIF形式）
- カテゴリーの付与（複数選択可能）

#### 投稿表示
- タイムライン形式での表示
- 投稿詳細表示
- 閲覧数のトラッキング（同一IPアドレスからの重複カウント防止）

### 2.3 エンゲージメント機能

#### いいね機能
- 投稿へのいいね／いいね解除
- いいね数の表示
- いいねしたユーザー一覧の表示

#### コメント機能
- 投稿へのコメント追加
- コメント一覧表示
- コメント数の表示

#### フォロー機能
- ユーザーのフォロー／アンフォロー
- フォロー中・フォロワー数の表示
- フォロー中・フォロワー一覧の表示

### 2.4 通知機能

以下のアクションで通知を生成：
- フォローされた時
- 投稿にいいねされた時
- 投稿にコメントされた時

通知の機能：
- 未読/既読管理
- 通知一覧の表示
- 通知のリアルタイム更新

### 2.5 カテゴリ管理

- カテゴリーの一覧表示
- カテゴリーごとの投稿一覧表示
- カテゴリー別の投稿数表示

### 2.6 管理機能

#### ユーザー管理
- ユーザー一覧の表示
- ユーザー詳細情報の表示
- ユーザーロールの変更

#### システム管理
- システム状態の監視
- データベース接続状態の確認
- 利用統計情報の表示

## 3. 非機能要件

### 3.1 パフォーマンス要件
- ページロード時間：3秒以内
- 同時接続ユーザー数：最大1000人
- データベースレスポンス時間：500ms以内

### 3.2 セキュリティ要件
- パスワードの安全なハッシュ化
- セッション管理によるXSS対策
- CSRF対策の実装
- アップロードファイルの種類制限

### 3.3 可用性要件
- サービス稼働時間：24時間365日
- 計画メンテナンス時間：月1回深夜
- バックアップ：日次実施

### 3.4 スケーラビリティ要件
- ストレージの拡張性確保
- データベースの水平スケーリング対応
- キャッシュ層の導入可能性

## 4. 外部システム連携

### 4.1 ストレージシステム
- ローカルストレージまたはS3互換のオブジェクトストレージ
- 画像ファイルの保存と配信
- CDNによる配信機能

### 4.2 ロギングシステム
- アプリケーションログの収集
- エラーログの収集
- アクセスログの収集
- CloudWatchなどの監視システムとの連携

## 5. データ保持期間

- ユーザーデータ：退会後7年
- 投稿データ：永続
- ログデータ：1年
- セッション：24時間
- 通知：3ヶ月

## 6. 制限事項

### 6.1 ファイルアップロード
- 最大ファイルサイズ：5MB
- 許可する画像形式：JPEG、PNG、GIF
- 1ユーザーあたりの保存容量：100MB

### 6.2 投稿
- 1日あたりの投稿数制限：100件
- コメント文字数制限：1000文字
- 投稿本文の文字数制限：5000文字

### 6.3 フォロー
- フォロー上限数：5000人
- フォロワー数の制限なし

## 7. 開発環境要件

### 7.1 必要なサービス
- リレーショナルデータベース
- オブジェクトストレージ
- セッションストア
- ログ管理システム

### 7.2 開発ツール
- バージョン管理システム
- CI/CDパイプライン
- コード品質チェックツール
- テスト自動化ツール

＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

# ソーシャルメディアプラットフォーム APIメソッド仕様書
# APIメソッド一覧

| 分類 | コントローラ/サービス | メソッド名 | HTTPメソッド | エンドポイント | 説明 |
|-----|-------------------|------------|-------------|--------------|------|
| 認証 | AuthController | showSignupForm | GET | /auth/signup | サインアップフォーム表示 |
| 認証 | AuthController | register | POST | /auth/signup | ユーザー登録実行 |
| 認証 | AuthController | showLoginForm | GET | /auth/login | ログインフォーム表示 |
| 認証 | AuthController | authenticate | POST | /auth/login | 認証実行 |
| 認証 | AuthController | signOut | GET | /auth/logout | ログアウト実行 |
| 投稿 | MicropostController | listMicroposts | GET | /microposts | 投稿一覧取得 |
| 投稿 | MicropostController | getMicropostDetail | GET | /microposts/:id | 投稿詳細取得 |
| 投稿 | MicropostController | publishMicropost | POST | /microposts | 新規投稿作成 |
| 投稿 | MicropostController | removeMicropost | DELETE | /microposts/:id | 投稿削除 |
| 投稿 | MicropostController | incrementViewCount | POST | /microposts/:id/views | 閲覧数カウント |
| 投稿 | MicropostController | listUserMicroposts | GET | /users/:id/microposts | ユーザー投稿一覧取得 |
| プロフィール | ProfileController | showUserProfile | GET | /users/:id | プロフィール表示 |
| プロフィール | ProfileController | showProfileEditForm | GET | /users/:id/edit | プロフィール編集フォーム表示 |
| プロフィール | ProfileController | updateProfile | POST | /users/:id | プロフィール更新 |
| プロフィール | ProfileController | listFollowing | GET | /users/:id/following | フォロー中ユーザー一覧取得 |
| プロフィール | ProfileController | listFollowers | GET | /users/:id/followers | フォロワー一覧取得 |
| プロフィール | ProfileController | addFollower | POST | /users/:id/followers | フォロー実行 |
| プロフィール | ProfileController | removeFollower | DELETE | /users/:id/followers | フォロー解除 |
| プロフィール | ProfileController | getUserStats | GET | /users/:id/stats | ユーザー統計取得 |
| いいね | LikeController | addLike | POST | /microposts/:id/likes | いいね追加 |
| いいね | LikeController | removeLike | DELETE | /microposts/:id/likes | いいね解除 |
| いいね | LikeController | listLikedUsers | GET | /microposts/:id/likes | いいねユーザー一覧取得 |
| いいね | LikeController | listUserLikes | GET | /users/:id/likes | ユーザーのいいね一覧取得 |
| いいね | LikeController | countLikes | GET | /microposts/:id/likes/count | いいね数取得 |
| いいね | LikeController | hasUserLiked | GET | /microposts/:id/likes/check | いいね済み判定 |
| コメント | CommentController | addComment | POST | /microposts/:id/comments | コメント追加 |
| コメント | CommentController | removeComment | DELETE | /microposts/:id/comments/:commentId | コメント削除 |
| コメント | CommentController | listMicropostComments | GET | /microposts/:id/comments | 投稿のコメント一覧取得 |
| コメント | CommentController | updateComment | PUT | /microposts/:id/comments/:commentId | コメント更新 |
| カテゴリ | CategoryController | listCategories | GET | /categories | カテゴリ一覧取得 |
| カテゴリ | CategoryController | getCategoryDetail | GET | /categories/:id | カテゴリ詳細取得 |
| カテゴリ | CategoryController | listCategoryMicroposts | GET | /categories/:id/microposts | カテゴリ別投稿一覧取得 |
| カテゴリ | CategoryController | addCategory | POST | /admin/categories | カテゴリ追加（管理者用） |
| カテゴリ | CategoryController | updateCategory | PUT | /admin/categories/:id | カテゴリ更新（管理者用） |
| カテゴリ | CategoryController | removeCategory | DELETE | /admin/categories/:id | カテゴリ削除（管理者用） |
| 通知 | NotificationController | listNotifications | GET | /notifications | 通知一覧取得 |
| 通知 | NotificationController | markNotificationAsRead | POST | /notifications/:id/read | 既読化 |
| 通知 | NotificationController | countUnreadNotifications | GET | /notifications/unread/count | 未読数取得 |
| 通知 | NotificationController | sendNotification | POST | /notifications | 通知送信 |
| 通知 | NotificationController | removeNotification | DELETE | /notifications/:id | 通知削除 |
| 通知 | NotificationController | clearAllNotifications | DELETE | /notifications | 全通知削除 |
| 管理 | AdminController | showDashboard | GET | /admin | 管理ダッシュボード表示 |
| 管理 | AdminController | listUsers | GET | /admin/users | ユーザー一覧取得 |
| 管理 | AdminController | getUserDetail | GET | /admin/users/:id | ユーザー詳細取得 |
| 管理 | AdminController | assignUserRoles | POST | /admin/users/:id/roles | ユーザーロール割り当て |
| 管理 | AdminController | suspendUser | POST | /admin/users/:id/suspend | ユーザー一時停止 |
| 管理 | AdminController | activateUser | POST | /admin/users/:id/activate | ユーザー有効化 |
| 管理 | AdminController | listSystemLogs | GET | /admin/logs | システムログ取得 |
| システム監視 | MonitoringController | checkSystemHealth | GET | /health | システム状態確認 |
| システム監視 | MonitoringController | checkDatabaseHealth | GET | /health/db | データベース状態確認 |
| システム監視 | MonitoringController | collectSystemMetrics | GET | /metrics | システムメトリクス取得 |
| システム監視 | MonitoringController | getServerStatus | GET | /status | サーバーステータス取得 |
| システム監視 | MonitoringController | listActiveUsers | GET | /metrics/active-users | アクティブユーザー数取得 |

## メソッド命名規則

1. 一覧取得系: list...
2. 詳細取得系: get...Detail
3. 表示系: show...
4. 追加系: add...
5. 更新系: update...
6. 削除系: remove...
7. カウント系: count...
8. チェック系: check...
9. 送信系: send...

## HTTPメソッドとの対応

- GET: list..., get..., show..., check..., count...
- POST: add..., create..., publish..., send..., assign...
- PUT/PATCH: update..., modify...
- DELETE: remove..., clear...

## 注意点

- コントローラメソッドとサービスメソッドは基本的に同名
- ビュー表示系メソッド（show...）はサービスメソッドを持たない場合がある
- 表示用メソッドでもデータ取得が必要な場合は、get...というサービスメソッドとペアになる
