#!/bin/bash

# 共通の変数定義
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NPM_GLOBAL_DIR="$HOME/.npm-global"
ENV_FILE="$(cd "$SCRIPT_DIR/.." && pwd)/.env"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$SCRIPT_DIR/config"

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

# AWS認証情報の更新
update_aws_credentials() {
    log_info "Updating AWS credentials"
    local access_key=$(aws configure get aws_access_key_id)
    local secret_key=$(aws configure get aws_secret_access_key)

    if [ -z "$access_key" ] || [ -z "$secret_key" ]; then
        log_error "AWS credentials not found in ~/.aws/config"
    fi

    local backup_file="$ENV_FILE.backup_$TIMESTAMP"
    cp "$ENV_FILE" "$backup_file"

    local tmp_file=$(mktemp)
    while IFS= read -r line; do
        if [[ $line == AWS_ACCESS_KEY_ID=* ]]; then
            echo "AWS_ACCESS_KEY_ID=$access_key"
        elif [[ $line == AWS_SECRET_ACCESS_KEY=* ]]; then
            echo "AWS_SECRET_ACCESS_KEY=$secret_key"
        else
            echo "$line"
        fi
    done < "$ENV_FILE" > "$tmp_file"

    mv "$tmp_file" "$ENV_FILE"
    echo "AWS credentials have been updated in $ENV_FILE"
    echo "Backup created at $backup_file"
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
    update_aws_credentials
    
    log_info "Setup completed successfully"
}

# スクリプトの実行
main 