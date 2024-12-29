# ビルドステージ
FROM node:18-alpine AS builder
WORKDIR /app

# OpenSSLをインストール
RUN apk add --no-cache openssl openssl-dev

# 依存関係のインストールと Prisma の生成
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci && \
    npx prisma generate

# アプリケーションコードのコピー
COPY . .

# 実行ステージ
FROM node:18-alpine
WORKDIR /app

# OpenSSLをインストール
RUN apk add --no-cache openssl openssl-dev

# 必要なファイルのみをコピー
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src

EXPOSE 8080

# package.jsonのスクリプトを使用して起動
CMD ["npm", "run", "docker:start"]