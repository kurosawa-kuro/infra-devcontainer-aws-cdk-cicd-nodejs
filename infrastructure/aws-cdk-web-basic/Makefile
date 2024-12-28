# ===========================================
# AWS and CDK Configuration
# ===========================================
AWS_ACCOUNT_ID = 476114153361
REGION_TOKYO = ap-northeast-1
REGION_VIRGINIA = us-east-1

# CDK Command Settings
CDK = cdk
DEPLOY_FLAGS = --require-approval never
DESTROY_FLAGS = --force --debug

# ===========================================
# Stack and Resource Names
# ===========================================
PREFIX = CdkExpress02
MAIN_STACK = AwsCdkWebBasicStack
DESTROY_STACK = DestroyStack
WAF_STACK = $(PREFIX)-WebAclStack

# ===========================================
# Helper Functions
# ===========================================
define bootstrap_regions
	@printf "\033[31m=== Bootstrapping CDK in both regions ===\033[0m\n"
	$(CDK) bootstrap aws://$(AWS_ACCOUNT_ID)/$(REGION_TOKYO) aws://$(AWS_ACCOUNT_ID)/$(REGION_VIRGINIA)
	@printf "\033[31m=============================================\033[0m\n"
endef

define check_failed_stacks
	@printf "\033[31m=== Checking for failed CloudFormation stacks ===\033[0m\n"
	@aws cloudformation list-stacks --region $(REGION_TOKYO) \
		--query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE` && StackStatus!=`CREATE_COMPLETE` && StackStatus!=`UPDATE_COMPLETE`].[StackName,StackStatus,StackStatusReason]' \
		--output table || true
	@printf "\033[31m=============================================\033[0m\n"
endef

# ===========================================
# Main Deployment Commands
# ===========================================
.PHONY: first-deploy destroy reset-deploy

# Bootstrap both regions and deploy main stack
first-deploy:
	$(call bootstrap_regions)
	@printf "\033[31m=== Deploying main stacks ===\033[0m\n"
	$(CDK) deploy $(MAIN_STACK) $(WAF_STACK) $(DEPLOY_FLAGS)
	@printf "\033[31m=== Deployment completed successfully ===\033[0m\n"
	@printf "\033[31m=============================================\033[0m\n"

# Reset and redeploy all stacks
reset-deploy:
	@printf "\033[31m=== Starting full reset and redeploy ===\033[0m\n"
	$(MAKE) destroy
	@printf "\033[31m=============================================\033[0m\n"
	@printf "\033[31m=== Starting fresh deployment ===\033[0m\n"
	$(MAKE) first-deploy
	@printf "\033[31m=== Reset and redeploy completed successfully ===\033[0m\n"
	@printf "\033[31m=============================================\033[0m\n"

# Destroy all stacks
destroy:
	$(call bootstrap_regions)
	$(call check_failed_stacks)
	@printf "\033[31m=== Destroying stacks ===\033[0m\n"
	-$(CDK) destroy $(MAIN_STACK) $(DESTROY_FLAGS)
	-$(CDK) destroy $(WAF_STACK) $(DESTROY_FLAGS)
	@printf "\033[31m=== Destroy process completed ===\033[0m\n"
	@printf "\033[31m=============================================\033[0m\n"