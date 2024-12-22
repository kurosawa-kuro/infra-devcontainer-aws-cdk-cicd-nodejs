.PHONY: init dev test env setup check staging production pm2-status pm2-stop pm2-restart pm2-logs db-studio db-migrate db-reset db-generate ecr-build-push

# スクリプトパスの定義
SCRIPT_DIR := script
AMAZON_LINUX_DIR := $(SCRIPT_DIR)/amazon-linux-2023
ECS_DIR := $(SCRIPT_DIR)/ecs
SETUP_SCRIPTS := $(SCRIPT_DIR)/setup-web-app.sh \
				 $(AMAZON_LINUX_DIR)/check-versions.sh \
				 $(AMAZON_LINUX_DIR)/setup-amazon-linux-2023.sh \
				 $(AMAZON_LINUX_DIR)/unistall-amazon-linux-2023.sh \
				 $(ECS_DIR)/build-and-push.sh

# 初期セットアップとシステムチェック
#---------------------------------
setup: permissions
	./$(SCRIPT_DIR)/setup-web-app.sh
	@echo "\n=== Initial setup completed ==="

# dev/infra-devcontainer-aws-cdk-cicd-nodejs/script/amazon-linux-2023/setup-amazon-linux-2023.sh
setup-lib: permissions
	sudo ./$(AMAZON_LINUX_DIR)/setup-amazon-linux-2023.sh
	@echo "\n=== Initial setup completed ==="

permissions:
	@echo "=== Setting up file permissions ==="
	chmod u+x $(SETUP_SCRIPTS)

check:
	@echo "=== Checking environment versions ==="
	./$(AMAZON_LINUX_DIR)/check-versions.sh

# ECRビルドとプッシュ
#---------------------------------
.PHONY: ecr-build-push
ecr-build-push:
	@echo "=== Building and pushing Docker image to ECR ==="
	./$(ECS_DIR)/build-and-push.sh

# アプリケーション実行
#---------------------------------
.PHONY: dev staging production
dev:
	npm run dev

staging:
	npm run staging

production:
	npm run production

# PM2プロセス管理
#---------------------------------
.PHONY: pm2-status pm2-stop pm2-restart pm2-logs
pm2-status:
	@echo "=== Checking PM2 Status ==="
	npm run pm2-status

pm2-stop:
	@echo "=== Stopping PM2 Processes ==="
	npm run pm2-stop

pm2-restart:
	@echo "=== Restarting PM2 Processes ==="
	npm run pm2-restart

pm2-logs:
	@echo "=== Showing PM2 Logs ==="
	npm run pm2-logs

# データベース操作
#---------------------------------
.PHONY: db-studio db-migrate db-reset db-generate
db-studio:
	@echo "=== Starting Prisma Studio ==="
	npm run db-studio

db-migrate:
	@echo "=== Creating Database Migration ==="
	npm run db-migrate

db-reset:
	@echo "=== Resetting Database ==="
	npm run db-reset

db-generate:
	@echo "=== Generating Prisma Client ==="
	npm run db-generate

# テスト
#---------------------------------
.PHONY: test
test:
	npm test