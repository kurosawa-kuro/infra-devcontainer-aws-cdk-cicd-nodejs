# ===========================================
# AWS and CDK Configuration
# ===========================================
AWS_ACCOUNT_ID = 476114153361
REGION_TOKYO = ap-northeast-1
REGION_VIRGINIA = us-east-1

# CDK Command Settings
CDK = cdk
DEPLOY_FLAGS = --require-approval never
DESTROY_FLAGS = --force

# ===========================================
# Stack and Resource Names
# ===========================================
PREFIX = cdk-express-01
MAIN_STACK = InfraAwsCdkVpcAlbAmiS3CloudfrontStack
DESTROY_STACK = DestroyStack
WAF_STACK = $(PREFIX)-WebAclStack

# ===========================================
# Main Deployment Commands
# ===========================================
.PHONY: first-deploy destroy clean-with-destroy-stack

# Bootstrap both regions and deploy all stacks
first-deploy:
	$(CDK) bootstrap aws://$(AWS_ACCOUNT_ID)/$(REGION_TOKYO) aws://$(AWS_ACCOUNT_ID)/$(REGION_VIRGINIA) && \
	$(CDK) deploy --all $(DEPLOY_FLAGS)

# Destroy all stacks
destroy:
	$(CDK) destroy --all $(DESTROY_FLAGS)

# Clean up using destroy stack
clean-with-destroy-stack: 
	$(CDK) deploy $(DESTROY_STACK) $(DEPLOY_FLAGS)
	$(CDK) destroy $(DESTROY_STACK) $(DESTROY_FLAGS) 