# 全PHONYターゲットの宣言
.PHONY: setup permissions check \
        ecr-build-push \
        dev staging prod prod-test \
        pm2-status pm2-stop pm2-restart pm2-logs \
        db-studio db-migrate db-reset db-generate db-deploy \
        docker-start \
        test \
        batch-s3-log batch-s3-log-now

# 変数定義
#---------------------------------
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

permissions:
	@echo "=== Setting up file permissions ==="
	chmod u+x $(SETUP_SCRIPTS)

check:
	@echo "=== Checking environment versions ==="
	./$(AMAZON_LINUX_DIR)/check-versions.sh

# インフラストラクチャ操作
#---------------------------------
ecr-build-push:
	@echo "=== Building and pushing Docker image to ECR ==="
	./$(ECS_DIR)/build-and-push.sh

# アプリケーション実行
#---------------------------------
dev:
	npm run dev

staging:
	npm run staging

prod:
	npm run prod

prod-test:
	npm run prod:test

# PM2プロセス管理
#---------------------------------
pm2-status:
	@echo "=== Checking PM2 Status ==="
	npm run pm2:status

pm2-stop:
	@echo "=== Stopping PM2 Processes ==="
	npm run pm2:stop

pm2-restart:
	@echo "=== Restarting PM2 Processes ==="
	npm run pm2:restart

pm2-logs:
	@echo "=== Showing PM2 Logs ==="
	npm run pm2:logs

# データベース操作
#---------------------------------
db-studio:
	@echo "=== Starting Prisma Studio ==="
	npm run db:studio

db-migrate:
	@echo "=== Creating Database Migration ==="
	npm run db:migrate

db-reset:
	@echo "=== Resetting Database ==="
	npm run db:reset

db-generate:
	@echo "=== Generating Prisma Client ==="
	npm run db:generate

db-deploy:
	@echo "=== Deploying Database Migrations ==="
	npm run db:deploy

# Docker操作
#---------------------------------
docker-start:
	@echo "=== Starting Docker Container ==="
	npm run docker:start

# テスト
#---------------------------------
test:
	npm test

# バッチ処理
#---------------------------------
batch-s3-log:
	@echo "=== Running S3 Log Batch Process ==="
	npm run batch:s3-log

batch-s3-log-now:
	@echo "=== Running S3 Log Batch Process (Immediate) ==="
	npm run batch:s3-log:now

# ファイル構造表示
tree:
	tree -I "node_modules" | cat

# ===========================================
# Development Support Commands
# ===========================================
.PHONY: mark-success

SUCCESS_DATE := $(shell date +%Y%m%d)
SUCCESS_TAG := success-$(SUCCESS_DATE)
SUCCESS_MESSAGE := "Successful deployment on $(shell date '+%b %d, %Y')"

mark-success:
    $(call log_section,Marking successful configuration)
    @git tag -a "$(SUCCESS_TAG)" -m $(SUCCESS_MESSAGE)
    @git push origin $(SUCCESS_TAG)
    $(call log_section,Success marker added)
    $(call log_end_section)