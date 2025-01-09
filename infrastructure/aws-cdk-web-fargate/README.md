はい、CDKで完全に自動化できます！

以下のように実装できます：

```typescript
// 必要なモジュールをインポート
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

// ALBリスナーの設定部分を修正
private configureAlbListener(
  alb: elbv2.ApplicationLoadBalancer,
  targetGroup: elbv2.ApplicationTargetGroup
): void {
  // SSL証明書の作成
  // 注意: ACMの証明書はALBと同じリージョンに作成する必要があります
  const certificate = new acm.Certificate(this, 'AlbSslCertificate', {
    domainName: alb.loadBalancerDnsName,
    validation: acm.CertificateValidation.withoutDns(),  // DNS検証なしで発行
  });

  // HTTPSリスナーの作成（443ポート）
  const httpsListener = alb.addListener('HttpsListener', {
    port: 443,
    protocol: elbv2.ApplicationProtocol.HTTPS,
    certificates: [certificate],
    defaultTargetGroups: [targetGroup],
  });

  // HTTPリスナーの作成（80ポート）とHTTPSへのリダイレクト設定
  alb.addListener('HttpListener', {
    port: 80,
    defaultAction: elbv2.ListenerAction.redirect({
      protocol: 'HTTPS',
      port: '443',
      permanent: true
    })
  });
}
```

ただし、注意点があります：

1. 証明書作成時のタイミング
```typescript
// 証明書の発行と検証には数分かかる場合があります
// CloudFormationのスタック作成時に自動的に待機します
```

2. リージョンの考慮
```typescript
// ACMの証明書はALBと同じリージョンに作成する必要があります
// CloudFrontを使用する場合は、us-east-1リージョンに証明書が必要です
```

3. セキュリティグループの設定
```typescript
// 443ポートのインバウンドルールを追加
albSg.addIngressRule(
  ec2.Peer.anyIpv4(),
  ec2.Port.tcp(443),
  'Allow HTTPS'
);
```

この設定で、CDK deployを実行すると：
1. SSL証明書の作成
2. ALBへの証明書の紐付け
3. HTTPSリスナーの設定
4. HTTPからHTTPSへのリダイレクト

が全て自動的に行われます。