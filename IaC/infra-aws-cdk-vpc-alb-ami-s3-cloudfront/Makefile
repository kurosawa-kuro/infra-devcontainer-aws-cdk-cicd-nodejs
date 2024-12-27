# CDKコマンドの定義
CDK = cdk
DEPLOY_FLAGS = --require-approval never
DESTROY_FLAGS = --force

# プレフィックスとリソース名の定義
PREFIX = cdk-express-01
WAF_NAME = $(PREFIX)-cf-waf

# リージョンとスタック名の定義
REGION_TOKYO = ap-northeast-1
REGION_VIRGINIA = us-east-1
MAIN_STACK = InfraAwsCdkVpcAlbAmiS3CloudfrontStack
WAF_STACK = $(PREFIX)-WebAclStack

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
.PHONY: force-cleanup-all
force-cleanup-all:
	# まず、CloudFrontディストリビューションを削除
	-aws cloudformation delete-stack --stack-name $(MAIN_STACK) --region $(REGION_TOKYO)
	-aws cloudformation wait stack-delete-complete --stack-name $(MAIN_STACK) --region $(REGION_TOKYO)

	# 次に、WAF WebACLを削除
	-aws cloudformation delete-stack --stack-name $(WAF_STACK) --region $(REGION_VIRGINIA)
	-aws cloudformation wait stack-delete-complete --stack-name $(WAF_STACK) --region $(REGION_VIRGINIA)

	# 残っているスタックを確認
	@echo "Checking remaining stacks in $(REGION_TOKYO):"
	@aws cloudformation list-stacks --region $(REGION_TOKYO) --query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].[StackName,StackStatus]' --output table
	@echo "Checking remaining stacks in $(REGION_VIRGINIA):"
	@aws cloudformation list-stacks --region $(REGION_VIRGINIA) --query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].[StackName,StackStatus]' --output table

# 開発用コマンド
.PHONY: init
init:
	$(CDK) init app --language typescript 