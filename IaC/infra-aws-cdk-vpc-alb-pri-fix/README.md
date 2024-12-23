はい、申し訳ありません。ロードバランサーの設定も含めて、完全な手順を説明します。

### ①パブリックパターンの場合（usePrivateSubnet = false）

1. CDKの設定変更:
```typescript
export class InfraConfig implements IInfraConfig {
    public readonly prefix = 'cdk-vpc-js-express-ejs-8080';
    public readonly region = 'ap-northeast-1';
    public readonly appPort = 8080;
    public readonly vpcCidr = '10.0.0.0/16';
    public readonly publicSubnet1Cidr = '10.0.10.0/24';
    public readonly publicSubnet2Cidr = '10.0.11.0/24';
    public readonly privateSubnet1Cidr = '10.0.20.0/24';
    public readonly privateSubnet2Cidr = '10.0.21.0/24';
    public readonly healthCheckPath = '/health';
    public readonly usePrivateSubnet = false;  // この値をfalseに変更
}
```

2. デプロイ手順:
```bash
cdk deploy
```

3. EC2手動作成手順:
1. AWSコンソールからEC2ダッシュボードを開く
2. 「インスタンスを起動」をクリック
3. 以下の設定を行う:
   - AMI: Amazon Linux 2023を選択
   - インスタンスタイプ: t2.microなど必要なサイズ
   - ネットワーク設定:
     - VPC: CDKで作成したVPC（名前: cdk-vpc-js-express-ejs-8080-vpc）
     - サブネット: パブリックサブネットを選択
     - セキュリティグループ: CDKで作成したインスタンス用SG（名前: cdk-vpc-js-express-ejs-8080-instance-sg）
   - キーペア: 新規作成または既存のものを選択
   - アドバンスト詳細:
     - IAMロール: 必要に応じて設定

4. EC2の設定:
```bash
# EC2にSSH接続
ssh -i your-key.pem ec2-user@<パブリックIP>

# アプリケーションのセットアップ（例：Node.jsアプリ）
sudo yum update -y
sudo yum install -y nodejs npm
mkdir ~/app
cd ~/app

# サンプルアプリケーションの作成
cat << EOF > app.js
const express = require('express');
const app = express();
const port = 8080;

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => {
  console.log(\`App listening at port \${port}\`);
});
EOF

# package.jsonの作成
npm init -y
npm install express

# アプリケーションの起動
node app.js
```

5. ロードバランサーの設定:
1. EC2ダッシュボードでインスタンスを選択
2. アクション → Target Groupへの登録
3. 既存のTarget Groupを選択:
   - CDKで作成されたTarget Group（名前: cdk-vpc-js-express-ejs-8080-tg）を選択
   - 「インスタンスの追加」をクリック
4. ヘルスチェックの確認:
   - EC2コンソールのTarget Groupsで、登録したインスタンスのヘルスチェックが「healthy」になることを確認
   - ALBのDNS名にアクセスしてアプリケーションの動作を確認:
     ```
     http://<ALBのDNS名>/
     http://<ALBのDNS名>/health
     ```

### ②プライベートパターンの場合（usePrivateSubnet = true）

1. CDKの設定:
```typescript
export class InfraConfig implements IInfraConfig {
    public readonly prefix = 'cdk-vpc-js-express-ejs-8080';
    public readonly region = 'ap-northeast-1';
    public readonly appPort = 8080;
    public readonly vpcCidr = '10.0.0.0/16';
    public readonly publicSubnet1Cidr = '10.0.10.0/24';
    public readonly publicSubnet2Cidr = '10.0.11.0/24';
    public readonly privateSubnet1Cidr = '10.0.20.0/24';
    public readonly privateSubnet2Cidr = '10.0.21.0/24';
    public readonly healthCheckPath = '/health';
    public readonly usePrivateSubnet = true;  // デフォルト値のまま
}
```

2. デプロイ手順:
```bash
cdk deploy
```

3. 踏み台（Bastion）サーバーの作成:
1. EC2ダッシュボードから「インスタンスを起動」
2. 以下の設定で踏み台サーバーを作成:
   - AMI: Amazon Linux 2023
   - インスタンスタイプ: t2.micro
   - ネットワーク設定:
     - VPC: CDKで作成したVPC
     - サブネット: パブリックサブネット
     - 新規セキュリティグループ作成:
       - 名前: bastion-sg
       - インバウンドルール: SSH(22)を自分のIPからのみ許可
   - キーペア: 新規作成または既存のものを選択

4. プライベートEC2の作成:
1. EC2ダッシュボードから「インスタンスを起動」
2. 以下の設定を行う:
   - AMI: Amazon Linux 2023
   - インスタンスタイプ: 必要なサイズ
   - ネットワーク設定:
     - VPC: CDKで作成したVPC
     - サブネット: プライベートサブネット
     - セキュリティグループ: CDKで作成したインスタンス用SG
     - パブリックIP: 自動割り当て無効
   - キーペア: 踏み台サーバーと同じキーペアを使用
   - アドバンスト詳細:
     - IAMロール: 必要に応じて設定

5. セキュリティグループの追加設定:
1. 踏み台サーバーのセキュリティグループ（bastion-sg）を選択
2. インバウンドルールの編集:
   - タイプ: SSH (22)
   - ソース: あなたのIP (/32)
3. プライベートEC2のセキュリティグループにインバウンドルールを追加:
   - タイプ: SSH (22)
   - ソース: bastion-sgのセキュリティグループID

6. 踏み台経由でのアクセス設定:
```bash
# ローカルPC上で設定（~/.ssh/config）
Host bastion
    HostName <踏み台サーバーのパブリックIP>
    User ec2-user
    IdentityFile ~/.ssh/your-key.pem

Host private-ec2
    HostName <プライベートEC2のプライベートIP>
    User ec2-user
    IdentityFile ~/.ssh/your-key.pem
    ProxyCommand ssh bastion -W %h:%p

# プライベートEC2への接続
ssh private-ec2
```

7. アプリケーションのセットアップ:
```bash
# プライベートEC2上で実行
sudo yum update -y
sudo yum install -y nodejs npm
mkdir ~/app
cd ~/app

# サンプルアプリケーションの作成
cat << EOF > app.js
const express = require('express');
const app = express();
const port = 8080;

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => {
  console.log(\`App listening at port \${port}\`);
});
EOF

# package.jsonの作成
npm init -y
npm install express

# アプリケーションの起動
node app.js
```

8. ロードバランサーの設定:
1. EC2ダッシュボードでプライベートインスタンスを選択
2. アクション → Target Groupへの登録
3. 既存のTarget Groupを選択:
   - CDKで作成されたTarget Group（名前: cdk-vpc-js-express-ejs-8080-tg）を選択
   - 「インスタンスの追加」をクリック
4. ヘルスチェックの確認:
   - EC2コンソールのTarget Groupsで、登録したインスタンスのヘルスチェックが「healthy」になることを確認
   - ALBのDNS名にアクセスしてアプリケーションの動作を確認:
     ```
     http://<ALBのDNS名>/
     http://<ALBのDNS名>/health
     ```

この構成では、プライベートサブネットのEC2はインターネットアクセスをNATゲートウェイ経由で行い、管理者アクセスは踏み台サーバー経由で行います。アプリケーションへのアクセスは、パブリックサブネットに配置されたALB経由で行われ、ALBからプライベートサブネットのEC2へトラフィックが転送されます。