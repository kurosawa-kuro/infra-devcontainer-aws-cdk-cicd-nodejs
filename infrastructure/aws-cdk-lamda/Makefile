# 変数定義
FUNCTION_NAME := $(shell grep '^LAMBDA_FUNCTION_NAME=' ../../.env | cut -d '=' -f2-)

.PHONY: first-deploy reset-deploy destroy

# 初回デプロイ（AWSアカウントで初めてCDKを使用する場合）
first-deploy:
	npm install
	npm run build
	cdk bootstrap
	cdk deploy -c functionName=$(FUNCTION_NAME)

# 再デプロイ（既存のスタックを削除して再デプロイ）
reset-deploy:
	npm install
	npm run build
	cdk destroy -c functionName=$(FUNCTION_NAME) --force --require-approval never
	cdk deploy -c functionName=$(FUNCTION_NAME) --require-approval never

# スタックの削除
destroy:
	cdk destroy -c functionName=$(FUNCTION_NAME)