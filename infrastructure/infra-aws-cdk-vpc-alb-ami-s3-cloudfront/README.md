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

## 便利なコマンド

* `npm run build`   TypeScriptをJavaScriptにコンパイル
* `npm run watch`   変更を監視してコンパイル
* `npm run test`    Jestユニットテストを実行
* `npx cdk deploy`  デフォルトのAWSアカウント/リージョンにスタックをデプロイ
* `npx cdk diff`    デプロイ済みスタックと現在の状態を比較
* `npx cdk synth`   CloudFormationテンプレートを生成