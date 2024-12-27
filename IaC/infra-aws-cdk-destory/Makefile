# CDKコマンドの定義
CDK = cdk
DESTROY_FLAGS = --force --require-approval never

# プレフィックスとリソース名の定義
PREFIX = cdk-express-01
STACK_NAME = InfraAwsCdkDestoryStack

# リージョンの定義
REGION = ap-northeast-1

# リソース名の定義
VPC_NAME = $(PREFIX)-vpc
EC2_NAME = $(PREFIX)-ec2
ALB_NAME = $(PREFIX)-alb
S3_NAME = $(PREFIX)-s3
IAM_ROLE_NAME = $(PREFIX)-custom-role

# スタック管理コマンド
.PHONY: destroy
destroy:
	$(CDK) destroy --all $(DESTROY_FLAGS)

.PHONY: list
list:
	$(CDK) list

.PHONY: diff
diff:
	$(CDK) diff

.PHONY: synth
synth:
	$(CDK) synth
