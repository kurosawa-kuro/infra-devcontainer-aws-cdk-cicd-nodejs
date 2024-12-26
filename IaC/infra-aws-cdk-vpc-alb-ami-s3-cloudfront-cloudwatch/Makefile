# CDKコマンドの定義
CDK = cdk
DEPLOY_FLAGS = --require-approval never
DESTROY_FLAGS = --force

# スタック名の定義
MAIN_STACK = InfraAwsCdkVpcAlbAmiS3CloudfrontCloudwatchStack
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
	$(CDK) destroy $(MAIN_STACK) $(DESTROY_FLAGS)
	$(CDK) destroy $(WAF_STACK) $(DESTROY_FLAGS)

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
	$(MAKE) destroy && $(MAKE) first-deploy
