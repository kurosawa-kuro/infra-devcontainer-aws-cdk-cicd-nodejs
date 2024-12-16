#!/bin/bash

echo -e "\n=== Checking Global Dependencies ==="

# nodemonのチェックとインストール
if ! command -v nodemon &> /dev/null; then
    echo "Installing nodemon globally..."
    npm install -g nodemon
else
    echo "nodemon is already installed"
fi

# pm2のチェックとインストール
if ! command -v pm2 &> /dev/null; then
    echo "Installing pm2 globally..."
    npm install -g pm2
else
    echo "pm2 is already installed"
fi

echo -e "\n=== Setting up environment variables ==="
if [ ! -f .env ]; then
    echo "Creating .env file from example..."
    cp src/env/.env.example .env
    echo ".env file created successfully."
else
    echo ".env file already exists."
fi

# プロジェクトの依存関係をクリーンインストール
echo -e "\n=== Installing Project Dependencies ==="
rm -rf node_modules
rm -rf package-lock.json
npm install