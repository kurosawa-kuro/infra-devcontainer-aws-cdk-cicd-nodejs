# Lambda Slack Notification テスト用Makefile

# 環境変数の読み込み方法を修正
export SLACK_WEBHOOK_URL := $(shell grep '^_SLACK_WEBHOOK_URL=' ../../../.env | cut -d '=' -f2- | tr -d '\r')
export LAMBDA_SLACK_NOTIFICATION_FUNCTION := $(shell grep '^_LAMBDA_SLACK_NOTIFICATION_FUNCTION=' ../../../.env | cut -d '=' -f2- | tr -d '\r')
export AWS_REGION := $(shell grep '^_AWS_REGION=' ../../../.env | cut -d '=' -f2- | tr -d '\r')
export AWS_ACCESS_KEY_ID := $(shell grep '^_AWS_ACCESS_KEY_ID=' ../../../.env | cut -d '=' -f2- | tr -d '\r')
export AWS_SECRET_ACCESS_KEY := $(shell grep '^_AWS_SECRET_ACCESS_KEY=' ../../../.env | cut -d '=' -f2- | tr -d '\r')

.PHONY: test-slack-notification check-env

# 環境変数チェック
check-env:
	@if [ -z "$(SLACK_WEBHOOK_URL)" ]; then \
		echo "エラー: SLACK_WEBHOOK_URL が設定されていません。.env ファイルを確認してください。"; \
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

# Slack通知テスト
test-slack-notification: check-env
	@echo "SLACK_WEBHOOK_URL: $(SLACK_WEBHOOK_URL)"
	@echo "LAMBDA_SLACK_NOTIFICATION_FUNCTION: $(LAMBDA_SLACK_NOTIFICATION_FUNCTION)"
	@export AWS_REGION="$(AWS_REGION)" && \
	export AWS_ACCESS_KEY_ID="$(AWS_ACCESS_KEY_ID)" && \
	export AWS_SECRET_ACCESS_KEY="$(AWS_SECRET_ACCESS_KEY)" && \
	export LAMBDA_SLACK_NOTIFICATION_FUNCTION="$(LAMBDA_SLACK_NOTIFICATION_FUNCTION)" && \
	export SLACK_WEBHOOK_URL="$(SLACK_WEBHOOK_URL)" && \
	node send_notification.js "Lambda Function Test: Success 🎉"
	