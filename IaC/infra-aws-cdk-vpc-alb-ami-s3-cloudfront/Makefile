# CDKコマンドの定義
CDK = cdk
DEPLOY_FLAGS = --require-approval never
DESTROY_FLAGS = --force

# スタック名の定義
MAIN_STACK = InfraAwsCdkVpcAlbAmiS3CloudfrontStack
WAF_STACK = WebAclStack
STACK_NAME ?= $(MAIN_STACK)  # デフォルトのスタック名

# CDKプロジェクト作成
.PHONY: init
init:
	$(CDK) init app --language typescript

# 初回デプロイ
.PHONY: first-deploy
first-deploy:
	$(CDK) bootstrap && $(CDK) deploy --all $(DEPLOY_FLAGS)

# スタックの削除
.PHONY: destroy
destroy:
	$(CDK) destroy --all $(DESTROY_FLAGS)

# 特定スタックの削除
.PHONY: destroy-stack
destroy-stack:
	$(CDK) destroy $(STACK_NAME) $(DESTROY_FLAGS)

# メインスタックの削除
.PHONY: destroy-main
destroy-main:
	$(CDK) destroy $(MAIN_STACK) $(DESTROY_FLAGS)

# WAFスタックの削除
.PHONY: destroy-waf
destroy-waf:
	$(CDK) destroy $(WAF_STACK) $(DESTROY_FLAGS)

# 完全リセット時（削除→再デプロイ）
.PHONY: reset-deploy
reset-deploy:
	$(CDK) destroy --all $(DESTROY_FLAGS) && $(MAKE) first-deploy

# Cloudwatchスタックとリソースを含む完全リセット
.PHONY: full-reset-deploy
full-reset-deploy:
	# CloudWatchスタックの削除
	aws cloudformation delete-stack --stack-name InfraAwsCdkVpcAlbAmiS3CloudfrontCloudwatchStack --region ap-northeast-1
	aws cloudformation wait stack-delete-complete --stack-name InfraAwsCdkVpcAlbAmiS3CloudfrontCloudwatchStack --region ap-northeast-1
	
	# 既存のWAF WebACLの削除（us-east-1リージョン）
	aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 --query 'WebACLs[?Name==`cdk-express-02-cf-waf`].Id' --output text | \
	xargs -I {} aws wafv2 delete-web-acl --name cdk-express-02-cf-waf --scope CLOUDFRONT --id {} --region us-east-1 --lock-token $$(aws wafv2 get-web-acl --name cdk-express-02-cf-waf --scope CLOUDFRONT --id {} --region us-east-1 --query 'LockToken' --output text) || true
	
	# スタックの削除と再デプロイ
	$(CDK) destroy --all $(DESTROY_FLAGS) && $(MAKE) first-deploy
