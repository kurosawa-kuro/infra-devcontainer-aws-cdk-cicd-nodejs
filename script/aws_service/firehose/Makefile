# Firehoseログ送信タスク
.PHONY: send-default-log send-custom-log

# デフォルトログの送信
send-default-log:
	@echo "デフォルトログを送信します..."
	@node upload-log.js
	@echo "送信完了"

# 詳細なログの送信（引数不要）
send-custom-log:
	@echo "詳細なログを送信します..."
	@node upload-log.js '{"msg":"user login","user_id":123,"ip":"192.168.1.1","timestamp":"$(shell date -u +"%Y-%m-%dT%H:%M:%SZ")"}'
	@echo "送信完了"

# ヘルプ表示
help:
	@echo "使用可能なコマンド:"
	@echo "  make send-default-log         デフォルトログを送信"
	@echo "  make send-custom-log          詳細なログを送信"
	@echo "  make help                     このヘルプを表示"
