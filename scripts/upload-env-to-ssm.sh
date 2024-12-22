#!/bin/bash

# SSMのパラメータ名のプレフィックス
SSM_PREFIX="/ecs/aws-fargate-express-01"

# .envファイルを読み込んでSSMに保存
while IFS='=' read -r key value || [ -n "$key" ]; do
    # コメントと空行をスキップ
    if [[ $key =~ ^#.*$ ]] || [ -z "$key" ]; then
        continue
    fi
    
    # 値から引用符を削除
    value=$(echo "$value" | tr -d '"')
    
    # キーをトリム
    key=$(echo "$key" | xargs)
    
    # 機密情報は SecureString として保存、それ以外は String として保存
    if [[ $key == *"PASSWORD"* ]] || [[ $key == *"SECRET"* ]] || [[ $key == "DATABASE_URL" ]] || [[ $key == "AWS_SECRET_ACCESS_KEY" ]]; then
        aws ssm put-parameter \
            --name "${SSM_PREFIX}/${key}" \
            --value "${value}" \
            --type "SecureString" \
            --overwrite
    else
        aws ssm put-parameter \
            --name "${SSM_PREFIX}/${key}" \
            --value "${value}" \
            --type "String" \
            --overwrite
    fi
done < .env

echo "Environment variables have been uploaded to SSM Parameter Store" 