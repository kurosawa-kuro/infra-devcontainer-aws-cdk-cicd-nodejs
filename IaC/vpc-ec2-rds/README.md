# AWS CDK 作業手順書

AWS CDKとインフラ構築の手順書を以下のように整理しました：

# AWS環境構築手順書

## 1. 準備作業
- AWS CLI導入済みであること
- AWS認証情報設定済みであること
- CDKプロジェクト初期化済みであること

## 2. EC2アクセス用キーペア作成
```bash
# キーペア作成
aws ec2 create-key-pair --key-name training-03-key-web --query 'KeyMaterial' --output text > training-03-key-web.pem

# セキュリティ設定
chmod 400 training-03-key-web.pem
```

## 3. インフラのデプロイ
```bash
# 初回デプロイ
cdk bootstrap && cdk deploy --require-approval never

# 完全リセット時
cdk destroy --force && cdk bootstrap && cdk deploy --require-approval never
```

## 4. サーバー設定

### Webサーバー（Nginx）設定
1. バックアップ作成
2. 基本設定ファイル配置
3. Express用リバースプロキシ設定
   - ポート80でListen
   - アップロードサイズ10MB制限
   - タイムアウト300秒

### アプリケーション設定
1. サンプルアプリのクローン
2. 依存パッケージインストール
3. 環境変数設定
4. DBマイグレーション実行
5. アプリケーション起動

## 5. 構成内容

### システム基本設定
- 実行環境：localhost
- 権限：sudo使用
- パッケージ管理：dnf

### インストールパッケージ
- PostgreSQL 15
- Firewalld
- Nginx
- Node.js 20.x

### データベース（PostgreSQL）
- DB名：training
- ユーザー：postgres
- パスワード：postgres
- 認証方式：trust → md5
- 自動起動設定

### セキュリティ（Firewalld）
- HTTP/HTTPS許可
- 自動起動設定

## 6. 動作確認コマンド

### 基本確認
```bash
# Node.js
node --version
npm --version

# PostgreSQL
psql --version
systemctl status postgresql
sudo -u postgres psql -c "\l"

# Nginx
nginx -v
systemctl status nginx

# Firewall
firewall-cmd --list-all
```

### Ansible実行
```bash
cd /etc/ansible/playbooks
ansible-playbook check-installation.yml # インストール確認

cd /etc/ansible/playbooks
ansible-playbook -vv main.yml          # セットアップ実行

```

```
pgAdminへのアクセス：
URL: http://[EC2のIP]/pgadmin4/
Email: admin@example.com
Password: admin123
```

```
pgAdmin: http://[EC2のIP]/pgadmin5/
Express: http://[EC2のIP]/
```

## 3. デプロイコマンド

### 通常デプロイ
```bash
# ブートストラップとデプロイを実行（承認なし）
cdk bootstrap && cdk deploy --require-approval never
```

### 再デプロイ（完全リセット）
```bash
# スタックの削除、再ブートストラップ、再デプロイを一括実行
cdk destroy --force && cdk bootstrap && cdk deploy --require-approval never
```


```
# Nginxの設定

# 設定ファイルの作成
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup.$(date +%Y%m%d_%H%M%S)

sudo tee /etc/nginx/nginx.conf << 'EOF'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log notice;
pid /run/nginx.pid;

# Load dynamic modules. See /usr/share/doc/nginx/README.dynamic.
include /usr/share/nginx/modules/*.conf;

events {
   worker_connections 1024;
}

http {
   log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                     '$status $body_bytes_sent "$http_referer" '
                     '"$http_user_agent" "$http_x_forwarded_for"';

   access_log  /var/log/nginx/access.log  main;
   sendfile            on;
   tcp_nopush          on;
   keepalive_timeout   65;
   types_hash_max_size 4096;

   include             /etc/nginx/mime.types;
   default_type        application/octet-stream;

   # Load modular configuration files from the /etc/nginx/conf.d directory.
   include /etc/nginx/conf.d/*.conf;
}
EOF

sudo tee /etc/nginx/conf.d/express-api.conf << 'EOF'
# /etc/nginx/conf.d/express.conf
server {
    listen 80;
    server_name _;

    # クライアントリクエストボディサイズの制限を設定
    client_max_body_size 10M;  # 10MBまで許可

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # アップロードのタイムアウト設定
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
}
EOF

# 設定の反映
sudo nginx -t            # 構文チェック
sudo systemctl restart nginx  # 再起動

```
