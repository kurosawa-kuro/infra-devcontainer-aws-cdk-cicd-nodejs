.PHONY: init dev test env setup check staging production pm2-status pm2-stop pm2-restart pm2-logs db-studio db-migrate db-reset db-generate

# 初期セットアップ（全ての準備を一括実行）
init: permissions env setup
	@echo "\n=== Initial setup completed ==="

# 実行権限の付与
permissions:
	@echo "=== Setting up file permissions ==="
	chmod u+x src/scripts/setup.sh src/scripts/check-env.sh src/scripts/fix_ssh_permissions.sh

# 開発環境のセットアップ（依存関係のインストールなど）
setup:
	@echo "=== Setting up development environment ==="
	./src/scripts/setup.sh

# 環境のバージョンチェック
check:
	@echo "=== Checking environment versions ==="
	./src/scripts/check-env.sh

# 開発サーバーの起動（ローカル開発用）
dev:
	npx nodemon src/app.js

# テストの実行
test:
	npm test

# ステージング環境の起動（PM2）
staging:
	npm run staging

# 本番環境の起動（PM2）
production:
	npm run production

# PM2プロセスの状態確認
pm2-status:
	@echo "=== Checking PM2 Status ==="
	npx pm2 status

# PM2プロセスの停止
pm2-stop:
	@echo "=== Stopping PM2 Processes ==="
	npx pm2 stop all

# PM2プロセスの再起動
pm2-restart:
	@echo "=== Restarting PM2 Processes ==="
	npx pm2 restart all

# PM2ログの表示
pm2-logs:
	@echo "=== Showing PM2 Logs ==="
	npx pm2 logs

# Prismaスタジオの起動
db-studio:
	@echo "=== Starting Prisma Studio ==="
	npx prisma studio

# データベースマイグレーションの作成
db-migrate:
	@echo "=== Creating Database Migration ==="
	npx prisma migrate dev

# データベースのリセット（開発環境のみ）
db-reset:
	@echo "=== Resetting Database ==="
	npx prisma migrate reset

# Prismaクライアントの生成
db-generate:
	@echo "=== Generating Prisma Client ==="
	npx prisma generate