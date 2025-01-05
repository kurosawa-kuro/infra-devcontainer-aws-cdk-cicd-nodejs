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
PREFIX = CdkExpress04
MAIN_STACK = AwsCdkWebBasicStack
DESTROY_STACK = DestroyStack
WAF_STACK = $(PREFIX)-WebAclStack

# ===========================================
# Helper Functions
# ===========================================
define bootstrap_regions
	@printf "\033[32m=== Bootstrapping CDK in both regions ===\033[0m\n"
	$(CDK) bootstrap aws://$(AWS_ACCOUNT_ID)/$(REGION_VIRGINIA) --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --trust $(AWS_ACCOUNT_ID) --force --verbose
	$(CDK) bootstrap aws://$(AWS_ACCOUNT_ID)/$(REGION_TOKYO) --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --trust $(AWS_ACCOUNT_ID) --force --verbose
	@printf "\033[32m=============================================\033[0m\n"
endef

define check_failed_stacks
	@printf "\033[32m=== Checking for failed CloudFormation stacks ===\033[0m\n"
	@aws cloudformation list-stacks --region $(REGION_TOKYO) \
		--query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE` && StackStatus!=`CREATE_COMPLETE` && StackStatus!=`UPDATE_COMPLETE`].[StackName,StackStatus,StackStatusReason]' \
		--output table || true
	@printf "\033[32m=============================================\033[0m\n"
endef

define send_notification
	@printf "\033[32m=== Sending deployment notification ===\033[0m\n"
	@node script/invoke-lambda/send_notification.js "$(MESSAGE)"
	@printf "\033[32m=============================================\033[0m\n"
endef

# ===========================================
# Main Deployment Commands
# ===========================================
.PHONY: first-deploy destroy reset-deploy notify-test

# Test notification
notify-test:
	$(eval MESSAGE := "Test notification sent")
	$(call send_notification)

# Bootstrap both regions and deploy main stack with notification
first-deploy:
	$(call bootstrap_regions)
	@printf "\033[32m=== Deploying main stacks ===\033[0m\n"
	$(CDK) deploy $(MAIN_STACK) $(WAF_STACK) $(DEPLOY_FLAGS)
	$(eval MESSAGE := "First deployment completed successfully")
	$(call send_notification)
	@printf "\033[32m=== Deployment completed successfully ===\033[0m\n"
	@printf "\033[32m=============================================\033[0m\n"

# Reset and redeploy all stacks with notification
reset-deploy:
	@printf "\033[32m=== Starting full reset and redeploy ===\033[0m\n"
	$(MAKE) destroy
	@printf "\033[32m=============================================\033[0m\n"
	@printf "\033[32m=== Starting fresh deployment ===\033[0m\n"
	$(MAKE) first-deploy
	$(eval MESSAGE := "Reset and redeploy completed successfully")
	$(call send_notification)
	@printf "\033[32m=== Reset and redeploy completed successfully ===\033[0m\n"
	@printf "\033[32m=============================================\033[0m\n"

# Destroy all stacks with notification
destroy:
	$(call bootstrap_regions)
	$(call check_failed_stacks)
	@printf "\033[32m=== Destroying stacks ===\033[0m\n"
	-$(CDK) destroy $(MAIN_STACK) $(DESTROY_FLAGS)
	-$(CDK) destroy $(WAF_STACK) $(DESTROY_FLAGS)
	$(eval MESSAGE := "Stack destruction completed")
	$(call send_notification)
	@printf "\033[32m=== Destroy process completed ===\033[0m\n"
	@printf "\033[32m=============================================\033[0m\n"

# ===========================================
# Success Marking
# ===========================================
SUCCESS_DATE := $(shell date +%Y%m%d)
SUCCESS_TAG := success-$(SUCCESS_DATE)
SUCCESS_MESSAGE := "Successful on $(shell date '+%b %d, %Y')"

mark-success:
	@printf "\033[32m=== Marking successful configuration ===\033[0m\n"
	@git tag -a "$(SUCCESS_TAG)" -m $(SUCCESS_MESSAGE)
	@git push origin $(SUCCESS_TAG)
	@printf "\033[32m=== Success marker added ===\033[0m\n"
	@printf "\033[32m=============================================\033[0m\n"