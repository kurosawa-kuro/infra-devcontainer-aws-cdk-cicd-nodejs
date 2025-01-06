#!/bin/bash

echo -e "\n=== Checking Global Dependencies ==="

# Create directory for global packages if it doesn't exist
if [ ! -d "$HOME/.npm-global" ]; then
    echo "Creating npm global directory..."
    mkdir "$HOME/.npm-global"
    npm config set prefix "$HOME/.npm-global"
    # Add NPM_CONFIG_PREFIX to ~/.profile if it doesn't exist
    if ! grep -q "NPM_CONFIG_PREFIX" "$HOME/.profile"; then
        echo "export PATH=\$HOME/.npm-global/bin:\$PATH" >> "$HOME/.profile"
        echo "export NPM_CONFIG_PREFIX=\$HOME/.npm-global" >> "$HOME/.profile"
    fi
fi

# Ensure the npm global bin directory is in the current PATH
export PATH="$HOME/.npm-global/bin:$PATH"
export NPM_CONFIG_PREFIX="$HOME/.npm-global"

# nodemonのチェックとインストール
if ! command -v nodemon &> /dev/null; then
    echo "Installing nodemon globally..."
    npm install -g nodemon || sudo npm install -g nodemon
    # Verify installation
    if ! command -v nodemon &> /dev/null; then
        echo "Failed to install nodemon. Please check permissions and try again."
        exit 1
    fi
else
    echo "nodemon is already installed"
fi

# pm2のチェックとインストール
if ! command -v pm2 &> /dev/null; then
    echo "Installing pm2 globally..."
    npm install -g pm2 || sudo npm install -g pm2
    # Verify installation
    if ! command -v pm2 &> /dev/null; then
        echo "Failed to install pm2. Please check permissions and try again."
        exit 1
    fi
else
    echo "pm2 is already installed"
fi

echo -e "\n=== Setting up environment variables ==="
if [ -f .env ]; then
    # バックアップのタイムスタンプを作成
    timestamp=$(date +%Y%m%d_%H%M%S)
    backup_dir="script/config"
    backup_file="$backup_dir/.env.backup_${timestamp}"
    echo "Backing up existing .env file to ${backup_file}"
    cp .env "${backup_file}"
fi

# 新しい.envファイルをコピー
echo "Creating .env file from example..."
cp script/config/.env.example .env
echo ".env file created/updated successfully."

# プロジェクトの依存関係をクリーンインストール
echo -e "\n=== Installing Project Dependencies ==="
rm -rf node_modules
rm -rf package-lock.json
npm install --no-fund --no-audit

echo -e "\n=== Setting up Prisma ==="
# Prismaクライアントの生成
npx prisma generate

# 開発環境の場合のみマイグレーションとseederを実行
if [ "$NODE_ENV" != "production" ]; then
  echo "Running database migrations..."
  npx prisma migrate dev
  echo "Running database seeder..."
  npx prisma db seed
fi
