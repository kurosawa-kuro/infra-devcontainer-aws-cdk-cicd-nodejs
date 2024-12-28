マルチリージョンのCDKスタックを削除する場合、以下のような手順で実行する必要があります：

1. まず、スタックの構成を確認
```bash
cdk list
```
このコードの場合、2つのスタックが表示されるはずです：
- メインのスタック（ap-northeast-1リージョン）
- WAF用のスタック（us-east-1リージョン）：`cdkexpress02-WebAclStack`

2. スタックの削除順序を考慮して実行

```bash
cdk bootstrap aws://476114153361/ap-northeast-1 aws://476114153361/us-east-1

# まずメインのスタックを削除
cdk destroy AwsCdkWebBasicStack --debug --force

# 次にWAF用のスタックを削除
cdk destroy cdkexpress02-WebAclStack  --debug --force
```

または、全てのスタックを一度に削除する場合：
```bash
cdk destroy --all
```

注意点：
- CloudFrontディストリビューションの削除に時間がかかる（20-30分）ため、タイムアウトしないよう注意
- クロスリージョン参照があるため、`crossRegionReferences: true` が設定されていることを確認
- 削除前に `cdk diff` で削除されるリソースを確認することを推奨
- 必要に応じて `--force` オプションを使用（特にS3バケットに内容物がある場合など）

エラーが発生した場合の対処：
```bash
# 強制削除が必要な場合
cdk destroy --all --force

# デバッグ情報を表示
cdk destroy --all --debug
```