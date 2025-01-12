# 変数定義
FUNCTION_NAME := $(shell grep '^LAMBDA_SLACK_NOTIFICATION_FUNCTION=' ../../.env | cut -d '=' -f2-)
STACK_NAME := AwsErrorNotificationStack
AWS_REGION := $(shell grep '^AWS_REGION=' ../../.env | cut -d '=' -f2-)
AWS_ACCOUNT_ID := $(shell grep '^AWS_ACCOUNT_ID=' ../../.env | cut -d '=' -f2-)

# 依存関係のインストール
.PHONY: install
install:
	npm install

# 初回デプロイ（AWSアカウントで初めてCDKを使用する場合）
first-deploy: install
	@echo "Bootstrapping AWS environment for CDK..."
	cdk bootstrap "aws://985539793438/ap-northeast-1"
	@echo "Deploying CDK stack..."
	cdk deploy --require-approval never

# 再デプロイ（既存のスタックを削除して再デプロイ）
reset-deploy: destroy first-deploy

# スタックの削除
destroy:
	@echo "Destroying CDK stack..."
	cdk destroy --force

# スタックの状態確認
status:
	@echo "Checking stack status..."
	aws cloudformation describe-stacks \
		--stack-name $(STACK_NAME) \
		--query 'Stacks[0].StackStatus' \
		--output text

# スタックのイベント確認
events:
	@echo "Checking stack events..."
	aws cloudformation describe-stack-events \
		--stack-name $(STACK_NAME) \
		--query 'StackEvents[*].[Timestamp, ResourceStatus, ResourceType, LogicalResourceId, ResourceStatusReason]' \
		--output table
