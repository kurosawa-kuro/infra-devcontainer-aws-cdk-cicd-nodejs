# Lambda Slack Notification テスト用Makefile

# 環境変数の読み込み
SLACK_WEBHOOK_URL := $(shell grep '^SLACK_WEBHOOK_URL=' ../../.env | cut -d '=' -f2-)
LAMBDA_FUNCTION_NAME := $(shell grep '^LAMBDA_FUNCTION_NAME=' ../../.env | cut -d '=' -f2-)
AWS_REGION := $(shell grep '^_AWS_REGION=' ../../.env | cut -d '=' -f2-)
AWS_ACCESS_KEY_ID := $(shell grep '^_AWS_ACCESS_KEY_ID=' ../../.env | cut -d '=' -f2-)
AWS_SECRET_ACCESS_KEY := $(shell grep '^_AWS_SECRET_ACCESS_KEY=' ../../.env | cut -d '=' -f2-)

.PHONY: test-success test-error test-custom check-env help

# ヘルプ表示
help:
	@echo "使用可能なコマンド:"
	@echo "  make help              - このヘルプを表示"
	@echo "  make deploy-check      - Lambda関数のデプロイ状態を確認"
	@echo "  make test-success      - 成功通知のテスト送信"
	@echo "  make test-error        - エラー通知のテスト送信"
	@echo "  make test-custom       - カスタムメッセージのテスト送信"
	@echo ""
	@echo "注意: テストを実行する前に、Lambda関数がデプロイされていることを確認してください"
	@echo "Lambda関数のデプロイ方法:"
	@echo "  cd ../../infrastructure/aws-cdk-lamda"
	@echo "  make first-deploy      - 初回デプロイの場合"
	@echo "  make reset-deploy      - 再デプロイの場合"

# 環境変数チェック
check-env:
	@if [ -z "$(LAMBDA_FUNCTION_NAME)" ]; then \
		echo "エラー: LAMBDA_FUNCTION_NAME が設定されていません。.env ファイルを確認してください。"; \
		exit 1; \
	fi
	@if [ -z "$(AWS_REGION)" ]; then \
		echo "エラー: AWS_REGION が設定されていません。.env ファイルを確認してください。"; \
		exit 1; \
	fi
	@if [ -z "$(AWS_ACCESS_KEY_ID)" ]; then \
		echo "エラー: AWS_ACCESS_KEY_ID が設定されていません。.env ファイルを確認してください。"; \
		exit 1; \
	fi
	@if [ -z "$(AWS_SECRET_ACCESS_KEY)" ]; then \
		echo "エラー: AWS_SECRET_ACCESS_KEY が設定されていません。.env ファイルを確認してください。"; \
		exit 1; \
	fi

# Lambda関数の存在確認
deploy-check: check-env
	@echo "Lambda関数の存在確認中..."
	@export AWS_REGION="$(AWS_REGION)" && \
	export AWS_ACCESS_KEY_ID="$(AWS_ACCESS_KEY_ID)" && \
	export AWS_SECRET_ACCESS_KEY="$(AWS_SECRET_ACCESS_KEY)" && \
	aws lambda get-function --function-name $(LAMBDA_FUNCTION_NAME) > /dev/null 2>&1 || \
	(echo "エラー: Lambda関数 $(LAMBDA_FUNCTION_NAME) が見つかりません。\nデプロイが必要です。\n\nデプロイ方法:\ncd ../../infrastructure/aws-cdk-lamda\nmake first-deploy  # 初回デプロイの場合\nmake reset-deploy  # 再デプロイの場合" && exit 1)
	@echo "Lambda関数が見つかりました。テストを実行できます。"

# 成功通知のテスト送信
test-success: deploy-check
	@echo "環境変数の値を確認:"
	@echo "SLACK_WEBHOOK_URL: $(SLACK_WEBHOOK_URL)"
	@echo "LAMBDA_FUNCTION_NAME: $(LAMBDA_FUNCTION_NAME)"
	@echo "AWS_REGION: $(AWS_REGION)"
	@export AWS_REGION="$(AWS_REGION)" && \
	export AWS_ACCESS_KEY_ID="$(AWS_ACCESS_KEY_ID)" && \
	export AWS_SECRET_ACCESS_KEY="$(AWS_SECRET_ACCESS_KEY)" && \
	export LAMBDA_FUNCTION_NAME="$(LAMBDA_FUNCTION_NAME)" && \
	export SLACK_WEBHOOK_URL="$(SLACK_WEBHOOK_URL)" && \
	node send_notification.js "Lambda Function Test: Success 🎉"

# エラー通知のテスト送信
test-error: deploy-check
	@export AWS_REGION="$(AWS_REGION)" && \
	export AWS_ACCESS_KEY_ID="$(AWS_ACCESS_KEY_ID)" && \
	export AWS_SECRET_ACCESS_KEY="$(AWS_SECRET_ACCESS_KEY)" && \
	export LAMBDA_FUNCTION_NAME="$(LAMBDA_FUNCTION_NAME)" && \
	export SLACK_WEBHOOK_URL="$(SLACK_WEBHOOK_URL)" && \
	node send_notification.js "Lambda Function Test: Error Simulation" --error

# カスタムメッセージのテスト送信
test-custom: deploy-check
	@if [ -z "$(MESSAGE)" ]; then \
		echo "使用方法: make test-custom MESSAGE=\"送信したいメッセージ\""; \
		exit 1; \
	fi
	@export AWS_REGION="$(AWS_REGION)" && \
	export AWS_ACCESS_KEY_ID="$(AWS_ACCESS_KEY_ID)" && \
	export AWS_SECRET_ACCESS_KEY="$(AWS_SECRET_ACCESS_KEY)" && \
	export LAMBDA_FUNCTION_NAME="$(LAMBDA_FUNCTION_NAME)" && \
	export SLACK_WEBHOOK_URL="$(SLACK_WEBHOOK_URL)" && \
	node send_notification.js "$(MESSAGE)"