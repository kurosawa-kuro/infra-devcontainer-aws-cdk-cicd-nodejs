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
