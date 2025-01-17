CDK Basic


```
cdk init app --language typescript
```

```
# CDKコマンドの定義
CDK = cdk
DEPLOY_FLAGS = --require-approval never

# CDKプロジェクト作成
.PHONY: init
init:
	$(CDK) init app --language typescript

# 初回デプロイ
.PHONY: first-deploy
first-deploy:
	$(CDK) bootstrap && $(CDK) deploy $(DEPLOY_FLAGS)

# スタックの削除
.PHONY: destroy
destroy:
	$(CDK) destroy --force

# 完全リセット時（削除→再デプロイ）
.PHONY: reset-deploy
reset-deploy:
	$(MAKE) destroy && $(MAKE) first-deploy

```

- IaC/aaa/bin/aaa.ts
```
#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkVpcAlbS3CfRmonitorStack } from '../lib/infra-aws-cdk-vpc-alb-s3-cf-rmonitor-stack';

const app = new cdk.App();
new InfraAwsCdkVpcAlbS3CfRmonitorStack(app, 'InfraAwsCdkVpcAlbS3CfRmonitorStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});
```

```
for stack in $(aws cloudformation list-stacks --region us-east-1 --query 'StackSummaries[?contains(StackName, `WebAclStack`) && StackStatus!=`DELETE_COMPLETE`].StackName' --output text); do echo "Deleting $stack..."; aws cloudformation delete-stack --stack-name $stack --region us-east-1; done

for stack in $(aws cloudformation list-stacks --region ap-northeast-1 --query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].StackName' --output text); do echo "Deleting $stack..."; aws cloudformation delete-stack --stack-name $stack --region ap-northeast-1; done
```