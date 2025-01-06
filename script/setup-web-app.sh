#!/bin/bash

# 共通の変数定義
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NPM_GLOBAL_DIR="$HOME/.npm-global"
ENV_FILE="$(cd "$SCRIPT_DIR/.." && pwd)/.env"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$SCRIPT_DIR/config"

# コマンドラインオプションの処理
ONLY_UPDATE_CREDENTIALS=false

while getopts "u" opt; do
    case $opt in
        u)
            ONLY_UPDATE_CREDENTIALS=true
            ;;
        \?)
            echo "Invalid option: -$OPTARG" >&2
            exit 1
            ;;
    esac
done

# ヘルプメッセージの表示
show_usage() {
    echo "Usage: $0 [-u]"
    echo "Options:"
    echo "  -u    Only update credentials"
    exit 1
}

# ログ関数
log_info() {
    echo -e "\n=== $1 ==="
}

log_error() {
    echo "Error: $1"
    exit 1
}

# npmグローバルディレクトリのセットアップ
setup_npm_global() {
    if [ ! -d "$NPM_GLOBAL_DIR" ]; then
        log_info "Creating npm global directory"
        mkdir "$NPM_GLOBAL_DIR"
        npm config set prefix "$NPM_GLOBAL_DIR"
        if ! grep -q "NPM_CONFIG_PREFIX" "$HOME/.profile"; then
            echo "export PATH=$NPM_GLOBAL_DIR/bin:\$PATH" >> "$HOME/.profile"
            echo "export NPM_CONFIG_PREFIX=$NPM_GLOBAL_DIR" >> "$HOME/.profile"
        fi
    fi
    export PATH="$NPM_GLOBAL_DIR/bin:$PATH"
    export NPM_CONFIG_PREFIX="$NPM_GLOBAL_DIR"
}

# グローバルパッケージのインストール
install_global_package() {
    local package_name=$1
    if ! command -v "$package_name" &> /dev/null; then
        log_info "Installing $package_name globally"
        npm install -g "$package_name" || sudo npm install -g "$package_name"
        if ! command -v "$package_name" &> /dev/null; then
            log_error "Failed to install $package_name. Please check permissions and try again."
        fi
    else
        echo "$package_name is already installed"
    fi
}

# 環境変数ファイルの設定
setup_env_file() {
    if [ -f .env ]; then
        local backup_file="$BACKUP_DIR/.env.backup_$TIMESTAMP"
        log_info "Backing up existing .env file"
        cp .env "$backup_file"
        echo "Backup created at $backup_file"
    fi
    
    log_info "Creating .env file from example"
    cp "$SCRIPT_DIR/config/.env.example" .env
    echo ".env file created/updated successfully."
}

# 環境変数情報の更新
update_credentials() {
    local source_file="/home/ec2-user/secret/from"
    local env_file="$(cd "$SCRIPT_DIR/.." && pwd)/.env"
    
    log_info "Updating credentials from $source_file"
    
    if [ ! -f "$source_file" ]; then
        log_error "Source file $source_file not found"
    fi
    
    # Create backup of current .env file
    if [ -f "$env_file" ]; then
        cp "$env_file" "${env_file}.backup_$(date +%Y%m%d_%H%M%S)"
    fi
    
    # Update AWS credentials
    if grep -q "AWS_ACCESS_KEY_ID=" "$source_file"; then
        sed -i "s|^AWS_ACCESS_KEY_ID=.*|$(grep "^AWS_ACCESS_KEY_ID=" "$source_file")|" "$env_file"
    fi
    
    if grep -q "AWS_SECRET_ACCESS_KEY=" "$source_file"; then
        sed -i "s|^AWS_SECRET_ACCESS_KEY=.*|$(grep "^AWS_SECRET_ACCESS_KEY=" "$source_file")|" "$env_file"
    fi
    
    # Update Storage CDN URL
    if grep -q "STORAGE_CDN_URL=" "$source_file"; then
        sed -i "s|^STORAGE_CDN_URL=.*|$(grep "EnvVarCdnUrl" "$source_file" | cut -d'=' -f2-)|" "$env_file"
    fi
    
    # Update CloudFront Distribution ID
    if grep -q "STORAGE_CDN_DISTRIBUTION_ID=" "$source_file"; then
        sed -i "s|^STORAGE_CDN_DISTRIBUTION_ID=.*|$(grep "EnvVarCdnDistributionId" "$source_file" | cut -d'=' -f2-)|" "$env_file"
    fi
    
    # Update S3 Bucket
    if grep -q "STORAGE_S3_BUCKET=" "$source_file"; then
        sed -i "s|^STORAGE_S3_BUCKET=.*|$(grep "EnvVarS3Bucket" "$source_file" | cut -d'=' -f2-)|" "$env_file"
    fi
    
    # Update Slack Webhook URL
    if grep -q "SLACK_WEBHOOK_URL=" "$source_file"; then
        sed -i "s|^SLACK_WEBHOOK_URL=.*|$(grep "^SLACK_WEBHOOK_URL=" "$source_file")|" "$env_file"
    fi
    
    log_info "Credentials updated successfully"
    
    # Secure the .env file
    chmod 600 "$env_file"
}

# Prismaのセットアップ
setup_prisma() {
    log_info "Setting up Prisma"
    npx prisma generate

    if [ "$NODE_ENV" != "production" ]; then
        echo "Running database migrations..."
        npx prisma migrate dev
        echo "Running database seeder..."
        npx prisma db seed
    fi
}

# メイン実行フロー
main() {
    if [ "$ONLY_UPDATE_CREDENTIALS" = true ]; then
        log_info "Running only credentials update"
        update_credentials
        exit 0
    fi

    log_info "Starting Web App Setup"
    
    # NPMグローバル設定
    setup_npm_global
    
    # グローバルパッケージのインストール
    install_global_package "nodemon"
    install_global_package "pm2"
    
    # 環境変数の設定
    setup_env_file
    
    # プロジェクトの依存関係インストール
    log_info "Installing Project Dependencies"
    rm -rf node_modules package-lock.json
    npm install --no-fund --no-audit
    
    # Prismaセットアップ
    setup_prisma
    
    # AWS認証情報の更新
    update_credentials
    
    log_info "Setup completed successfully"
}

# スクリプトの実行
main 