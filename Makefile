.PHONY: init dev test env setup check staging production pm2-status pm2-stop pm2-restart pm2-logs db-studio db-migrate db-reset db-generate

# 初期セットアップ（全ての準備を一括実行）
setup: permissions
	./script/setup-web-app.sh
	@echo "\n=== Initial setup completed ==="


# 実行権限の付与
permissions:
	@echo "=== Setting up file permissions ==="
	chmod u+x script/setup-web-app.sh script/setup-key.sh script/amazon-linux-2023/check-versions.sh script/amazon-linux-2023/setup-amazon-linux-2023.sh script/amazon-linux-2023/unistall-amazon-linux-2023.sh

# 環境のバージョンチェック
check:
	@echo "=== Checking environment versions ==="
	./script/amazon-linux-2023/check-versions.sh

# 開発サーバーの起動（ローカル開発用）
dev:
	npm run dev

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