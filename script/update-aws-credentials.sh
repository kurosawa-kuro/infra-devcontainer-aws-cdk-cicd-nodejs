#!/bin/bash

# スクリプトのディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/config/.env"

# AWS CLIから認証情報を取得
ACCESS_KEY=$(aws configure get aws_access_key_id)
SECRET_KEY=$(aws configure get aws_secret_access_key)

# 認証情報が取得できたか確認
if [ -z "$ACCESS_KEY" ] || [ -z "$SECRET_KEY" ]; then
    echo "Error: AWS credentials not found in ~/.aws/config"
    exit 1
fi

# .envファイルのバックアップを作成
BACKUP_FILE="${ENV_FILE}.backup_$(date +%Y%m%d_%H%M%S)"
cp "$ENV_FILE" "$BACKUP_FILE"

# 一時ファイルを作成して.envを更新
TMP_FILE=$(mktemp)
while IFS= read -r line; do
    if [[ $line == AWS_ACCESS_KEY_ID=* ]]; then
        echo "AWS_ACCESS_KEY_ID=$ACCESS_KEY"
    elif [[ $line == AWS_SECRET_ACCESS_KEY=* ]]; then
        echo "AWS_SECRET_ACCESS_KEY=$SECRET_KEY"
    else
        echo "$line"
    fi
done < "$ENV_FILE" > "$TMP_FILE"

# 一時ファイルを.envに移動
mv "$TMP_FILE" "$ENV_FILE"

echo "AWS credentials have been updated in $ENV_FILE"
echo "Backup created at $BACKUP_FILE" 