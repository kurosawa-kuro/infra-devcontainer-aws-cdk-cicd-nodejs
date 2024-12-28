# CDK TypeScriptプロジェクトへようこそ

このプロジェクトは、TypeScriptを使用したCDK開発のためのプロジェクトです。

`cdk.json`ファイルは、CDK Toolkitがアプリケーションを実行する方法を指定します。

## Makefileの運用サイクル

このプロジェクトには、インフラストラクチャのライフサイクルを管理するための以下のmakeコマンドが用意されています：

### 初期設定とデプロイ
* `make init` - CDK TypeScriptアプリを新規作成
* `make first-deploy` - CDKのブートストラップを実行し、全スタックを初回デプロイ

### デプロイ管理
* `make reset-deploy` - 全スタックを削除し、一からデプロイをやり直し
* `make destroy` - CDKを使用して全スタックを削除

### クリーンアップ操作
* `make force-delete-stack STACK=<スタック名> [REGION=<リージョン>]` - 指定したスタックを強制削除
* `make force-cleanup-all` - 以下を含む全リソースの完全クリーンアップ：
  - CloudFrontディストリビューション
  - WAF WebACL
  - CloudWatchスタック
  - 東京リージョンとバージニアリージョンの残存スタックを表示

## 開発サイクル
```
make force-cleanup-all
make reset-deploy
```

AWSリソースの削除順序を依存関係に基づいて整理します。基本的には、他のリソースから依存されているリソースを後から削除する必要があります。

削除の順序:

1. CloudFront関連
   - まずCloudFrontディストリビューション（`CdkExpress01Cf`）
   - CloudFrontのWAF設定（`cdkexpress01-cf-waf`）
   - Origin Access Control（`CdkExpress01Oac`）
   - Cache Policy（`CdkExpress01CachePolicy`）

2. Application Load Balancer関連
   - ターゲットグループ（`CdkExpress01Tg`）
   - ALBリスナー
   - Application Load Balancer（`CdkExpress01Alb`）

3. EC2関連
   - EC2インスタンス（`CdkExpress01Ec2`）
   - アプリケーション用セキュリティグループ（`CdkExpress01AppSg`）
   - ALB用セキュリティグループ（`CdkExpress01AlbSg`）

4. S3関連
   - バケットポリシー
   - S3バケット（`cdkexpress01-s3`）
   
5. VPC関連（最後に削除）
   - サブネットルートテーブル（`CdkExpress01PublicRt1a`、`CdkExpress01PublicRt1c`）
   - パブリックサブネット（`CdkExpress01PublicSubnet1a`、`CdkExpress01PublicSubnet1c`）
   - インターネットゲートウェイ（`CdkExpress01Igw`）
   - VPC（`CdkExpress01Vpc`）

削除時の注意点:
- CloudFrontディストリビューションの削除には時間がかかります（20-30分程度）
- S3バケットを削除する前に、すべてのオブジェクトが削除されていることを確認
- VPCリソースは最後に削除する必要があり、上記の順序で削除することで依存関係による削除エラーを防ぐことができます