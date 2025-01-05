#!/bin/bash

# エラーが発生したら即座に終了
set -e

AWS_ACCOUNT_ID=448049833348

# 環境変数のチェック
if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo "Error: AWS_ACCOUNT_ID is not set"
    exit 1
fi

# 変数定義
REGION="ap-northeast-1"
REPOSITORY_NAME="aws-fargate-express-01-repository"
ECR_REPOSITORY="${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE_TAG="latest"

echo "=== Starting build and push process ==="

# ECRログイン
echo "Logging in to Amazon ECR..."
aws ecr get-login-password --region ${REGION} | \
docker login --username AWS --password-stdin ${ECR_REPOSITORY}

# Dockerイメージのビルド
echo "Building Docker image..."
docker build -t ${REPOSITORY_NAME} -f docker/production.Dockerfile .

# イメージのタグ付け
echo "Tagging image..."
docker tag ${REPOSITORY_NAME}:${IMAGE_TAG} ${ECR_REPOSITORY}/${REPOSITORY_NAME}:${IMAGE_TAG}

# ECRへのプッシュ
echo "Pushing image to ECR..."
docker push ${ECR_REPOSITORY}/${REPOSITORY_NAME}:${IMAGE_TAG}

echo "=== Build and push completed successfully ==="
echo "Image: ${ECR_REPOSITORY}/${REPOSITORY_NAME}:${IMAGE_TAG}" 