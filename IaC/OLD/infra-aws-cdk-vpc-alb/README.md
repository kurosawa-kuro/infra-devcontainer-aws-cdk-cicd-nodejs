# パブリックサブネットを持つVPC/ALB 構成仕様書

## 1. VPC構成
### VPC基本設定
- VPC名: cdk-vpc-js-express-ejs-8080-vpc
- CIDRブロック: 10.0.0.0/16
- リージョン: ap-northeast-1

### パブリックサブネット構成
- サブネット1
  - 名称: cdk-vpc-js-express-ejs-8080-subnet-pub-1a
  - アベイラビリティゾーン: ap-northeast-1a
  - CIDRブロック: 10.0.10.0/24

- サブネット2
  - 名称: cdk-vpc-js-express-ejs-8080-subnet-pub-1c
  - アベイラビリティゾーン: ap-northeast-1c
  - CIDRブロック: 10.0.11.0/24

### インターネットゲートウェイ
- 名称: cdk-vpc-js-express-ejs-8080-igw
- VPCにアタッチ

### ルートテーブル
- 名称: cdk-vpc-js-express-ejs-8080-rtb-pub
- 関連付け: 両パブリックサブネット
- ルート:
  - ローカル通信: 10.0.0.0/16
  - インターネット向け: 0.0.0.0/0 → IGW

## 2. セキュリティグループ
- 名称: cdk-vpc-js-express-ejs-8080-sg-web
- インバウンドルール:
  - プロトコル: TCP
  - ポート: 8080
  - ソース: 0.0.0.0/0

## 3. ロードバランサー構成
### Application Load Balancer
- 名称: cdk-vpc-js-express-ejs-8080-elb
- タイプ: インターネット向け
- サブネット: 両パブリックサブネット
- セキュリティグループ: cdk-vpc-js-express-ejs-8080-sg-web

### リスナー設定
- プロトコル: HTTP
- ポート: 80
- デフォルトアクション: ターゲットグループへ転送

### ターゲットグループ
- 名称: cdk-vpc-js-express-ejs-8080-tg-alb
- ヘルスチェック設定:
  - プロトコル: HTTP
  - パス: /health
  - ポート: traffic-port
  - ヘルシー閾値: 2
  - アンヘルシー閾値: 2
  - タイムアウト: 5秒
  - 間隔: 30秒