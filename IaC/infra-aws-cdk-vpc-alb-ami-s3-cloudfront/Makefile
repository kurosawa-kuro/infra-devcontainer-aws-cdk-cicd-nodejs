# CDKコマンドの定義
CDK = cdk
DEPLOY_FLAGS = --require-approval never
DESTROY_FLAGS = --force

# リージョンとスタック名の定義
REGION_TOKYO = ap-northeast-1
REGION_VIRGINIA = us-east-1
MAIN_STACK = InfraAwsCdkVpcAlbAmiS3CloudfrontStack
WAF_STACK = WebAclStack
CLOUDWATCH_STACK = InfraAwsCdkVpcAlbAmiS3CloudfrontCloudwatchStack

# よく使うコマンド
.PHONY: first-deploy
first-deploy:
	$(CDK) bootstrap && $(CDK) deploy --all $(DEPLOY_FLAGS)

.PHONY: reset-deploy
reset-deploy:
	$(CDK) destroy --all $(DESTROY_FLAGS) && $(MAKE) first-deploy

# スタック管理コマンド
.PHONY: destroy
destroy:
	$(CDK) destroy --all $(DESTROY_FLAGS)

.PHONY: force-delete-stack
force-delete-stack:
	@if [ -z "$(STACK)" ]; then \
		echo "Usage: make force-delete-stack STACK=<stack-name> [REGION=<region>]"; \
		exit 1; \
	fi
	aws cloudformation delete-stack \
		--stack-name $(STACK) \
		--region $${REGION:-$(REGION_VIRGINIA)}
	aws cloudformation wait stack-delete-complete \
		--stack-name $(STACK) \
		--region $${REGION:-$(REGION_VIRGINIA)}

# 完全クリーンアップ
.PHONY: cleanup-all
cleanup-all:
	# CloudWatchスタックの削除
	-aws cloudformation delete-stack --stack-name $(CLOUDWATCH_STACK) --region $(REGION_TOKYO)
	-aws cloudformation wait stack-delete-complete --stack-name $(CLOUDWATCH_STACK) --region $(REGION_TOKYO)
	
	# 既存のWAF WebACLの削除
	-WEB_ACL_ID=$$(aws wafv2 list-web-acls --scope CLOUDFRONT --region $(REGION_VIRGINIA) \
		--query 'WebACLs[?Name==`cdk-express-02-cf-waf`].Id' --output text); \
	if [ ! -z "$$WEB_ACL_ID" ]; then \
		LOCK_TOKEN=$$(aws wafv2 get-web-acl --name cdk-express-02-cf-waf \
			--scope CLOUDFRONT --id $$WEB_ACL_ID --region $(REGION_VIRGINIA) \
			--query 'LockToken' --output text); \
		aws wafv2 delete-web-acl --name cdk-express-02-cf-waf \
			--scope CLOUDFRONT --id $$WEB_ACL_ID --region $(REGION_VIRGINIA) \
			--lock-token $$LOCK_TOKEN; \
	fi
	
	# 失敗したスタックの強制削除
	-aws cloudformation delete-stack --stack-name $(WAF_STACK) --region $(REGION_VIRGINIA)
	-aws cloudformation wait stack-delete-complete --stack-name $(WAF_STACK) --region $(REGION_VIRGINIA)
	-aws cloudformation delete-stack --stack-name $(MAIN_STACK) --region $(REGION_TOKYO)
	-aws cloudformation wait stack-delete-complete --stack-name $(MAIN_STACK) --region $(REGION_TOKYO)

# 開発用コマンド
.PHONY: init
init:
	$(CDK) init app --language typescript
