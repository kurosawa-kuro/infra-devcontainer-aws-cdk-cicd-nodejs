# CDK環境構築後の手動設定手順書

## 1. セキュリティグループの設定

### 1.1 Bastion用セキュリティグループの作成
1. VPCダッシュボード → セキュリティグループ → 「作成」
2. 基本情報
   ```
   名前: cdk-vpc-js-express-ejs-8080-sg-bastion
   説明: Security group for Bastion host
   VPC: cdk-vpc-js-express-ejs-8080-vpc
   ```
3. インバウンドルール
   ```
   Type: SSH (22)
   Source: マイIP
   ```

### 1.2 EC2用セキュリティグループの修正
1. 既存の `cdk-vpc-js-express-ejs-8080-sg-web` を選択
2. インバウンドルールに追加:
   ```
   Type: SSH (22)
   Source: cdk-vpc-js-express-ejs-8080-sg-bastion
   ```

## 2. EC2インスタンスの作成

### 2.1 Bastionサーバー作成
1. EC2ダッシュボード → 「インスタンスを起動」
2. 設定内容:
   ```
   名前: cdk-vpc-js-express-ejs-8080-bastion
   AMI: Amazon Linux 2023
   インスタンスタイプ: t2.micro
   
   ネットワーク:
   - VPC: cdk-vpc-js-express-ejs-8080-vpc
   - サブネット: パブリックサブネット
   - 自動割り当てパブリックIP: 有効
   - セキュリティグループ: cdk-vpc-js-express-ejs-8080-sg-bastion
   ```

### 2.2 アプリケーションサーバー作成
1. EC2ダッシュボード → 「インスタンスを起動」
2. 設定内容:
   ```
   名前: cdk-vpc-js-express-ejs-8080-ec2
   AMI: Amazon Linux 2023
   インスタンスタイプ: t2.micro
   
   ネットワーク:
   - VPC: cdk-vpc-js-express-ejs-8080-vpc
   - サブネット: プライベートサブネット
   - 自動割り当てパブリックIP: 無効
   - セキュリティグループ: cdk-vpc-js-express-ejs-8080-sg-web
   
   ユーザーデータ: 
   #!/bin/bash
   yum update -y
   yum install -y nodejs
   mkdir -p /app
   cd /app
   
   cat << 'EOF' > app.js
   const express = require('express');
   const app = express();
   app.get('/health', (req, res) => {
     res.status(200).send('OK');
   });
   app.listen(8080);
   EOF
   
   npm init -y
   npm install express
   node app.js &
   ```

## 3. ターゲットグループへのEC2登録
1. EC2ダッシュボード → ターゲットグループ
2. `cdk-vpc-js-express-ejs-8080-tg-alb` を選択
3. 「ターゲットの登録」をクリック
4. 作成したEC2インスタンスを選択
5. ポート: 8080 を指定
6. 「登録済みとして追加」をクリック

## 4. SSHアクセス設定

### 4.1 ローカル設定
1. キーペアの権限設定
   ```bash
   chmod 400 <キーペア名>.pem
   ```

2. ~/.ssh/config に追加
   ```
   Host bastion
     HostName <BastionのパブリックIP>
     User ec2-user
     IdentityFile ~/.ssh/<キーペア名>.pem
   
   Host app-server
     HostName <プライベートEC2のプライベートIP>
     User ec2-user
     IdentityFile ~/.ssh/<キーペア名>.pem
     ProxyCommand ssh bastion -W %h:%p
   ```

### 4.2 接続確認
```bash
# Bastionへの接続
ssh bastion

# アプリケーションサーバーへの接続
ssh app-server
```

## 5. 動作確認
1. ALBのDNS名を確認
2. ブラウザで `http://<ALBのDNS名>/health` にアクセス
3. "OK" が表示されることを確認