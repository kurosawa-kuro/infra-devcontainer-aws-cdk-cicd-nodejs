# 変数定義
FUNCTION_NAME := test_nodejs_02

.PHONY: deploy build clean

# デフォルトのターゲット
all: build deploy

# ビルド
build:
	npm run build

# デプロイ
deploy:
	cdk deploy -c functionName=$(FUNCTION_NAME)

# スタックの差分確認
diff:
	cdk diff -c functionName=$(FUNCTION_NAME)

# スタックの削除
destroy:
	cdk destroy -c functionName=$(FUNCTION_NAME)