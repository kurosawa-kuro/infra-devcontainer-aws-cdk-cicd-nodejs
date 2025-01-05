# ===========================================
# AWS and CDK Configuration
# ===========================================
AWS_ACCOUNT_ID = 448049833348
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
.PHONY: first-deploy destroy reset-deploy

# Bootstrap both regions and deploy main stack
first-deploy:
	$(CDK) bootstrap aws://$(AWS_ACCOUNT_ID)/$(REGION_TOKYO) aws://$(AWS_ACCOUNT_ID)/$(REGION_VIRGINIA) && \
	$(CDK) deploy $(MAIN_STACK) $(WAF_STACK) $(DEPLOY_FLAGS)

# Reset and redeploy all stacks
reset-deploy:
	@echo "=== Starting full reset and redeploy ==="
	$(MAKE) destroy
	@echo "\n=== Starting fresh deployment ==="
	$(MAKE) first-deploy

# Destroy all stacks
destroy:
	$(CDK) bootstrap aws://$(AWS_ACCOUNT_ID)/$(REGION_TOKYO) aws://$(AWS_ACCOUNT_ID)/$(REGION_VIRGINIA)
	@echo "=== Listing failed CloudFormation stacks ==="
	@aws cloudformation list-stacks --region $(REGION_TOKYO) \
		--query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE` && StackStatus!=`CREATE_COMPLETE` && StackStatus!=`UPDATE_COMPLETE`].[StackName,StackStatus,StackStatusReason]' \
		--output table || true
	@echo "\n=== Attempting to delete DestroyStack ==="
	@echo "Getting failed resources..."
	$(eval RETAIN_RESOURCES := $(shell aws cloudformation list-stack-resources --stack-name $(DESTROY_STACK) --region $(REGION_TOKYO) --query 'StackResourceSummaries[?ResourceStatus!=`DELETE_COMPLETE`].LogicalResourceId' --output text || echo ""))
	@echo "Deleting stack with retained resources: $(RETAIN_RESOURCES)"
	aws cloudformation delete-stack --stack-name $(DESTROY_STACK) --region $(REGION_TOKYO) --retain-resources $(RETAIN_RESOURCES) || true
	aws cloudformation wait stack-delete-complete --stack-name $(DESTROY_STACK) --region $(REGION_TOKYO) || true
	@echo "\n=== Deploying DestroyStack to clean up resources ==="
	$(CDK) deploy $(DESTROY_STACK) $(DEPLOY_FLAGS)