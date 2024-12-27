# Project Name

## 概要

## 必要条件

## インストール方法

## 使用方法

## 開発環境のセットアップ

## テスト

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
