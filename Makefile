.PHONY: init test dev start check setup env

# 実行権限の付与とnpm scriptsのセットアップ
init:
	@echo "=== Setting up permissions ==="
	chmod u+x src/env/init.sh src/env/check.sh src/env/fix_ssh_permissions.sh
	@echo "=== Setting up environment variables ==="
	make env

# 開発サーバーの起動
dev:
	nodemon src/app.js

# テストの実行
test:
	npm test

# ステージ及び、本番サーバーの起動
start:
	node src/app.js

# 環境のバージョンチェック
check:
	@echo "=== Checking Environment ==="
	./src/env/check.sh

# 開発環境のセットアップ
setup:
	@echo "=== Setting up Development Environment ==="
	./src/env/init.sh