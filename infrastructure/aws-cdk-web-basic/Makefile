# ===========================================
# AWS and CDK Configuration
# ===========================================
AWS_ACCOUNT_ID = 448049833348
REGION_TOKYO = ap-northeast-1

# ===========================================
# CDK Command Settings
# ===========================================
CDK = cdk
DEPLOY_FLAGS = --require-approval never
DESTROY_FLAGS = --force --debug

# ===========================================
# Stack and Resource Names
# ===========================================
PREFIX = CdkJavascript01
MAIN_STACK = AwsCdkWebBasicStack

# ===========================================
# Notification Messages
# ===========================================
NOTIFY_PREFIX = [INFO]
NOTIFY_TEST = [TEST]_Notification_system_check
NOTIFY_DEPLOY = $(NOTIFY_PREFIX)_Deployment_completed
NOTIFY_DESTROY = $(NOTIFY_PREFIX)_Stack_destruction_completed
NOTIFY_FIRST_DEPLOY = $(NOTIFY_PREFIX)_First_deployment_completed
NOTIFY_RESET_DEPLOY = $(NOTIFY_PREFIX)_Reset_and_redeploy_completed

# ===========================================
# Helper Functions
# ===========================================
define log_section
	@printf "\033[32m=== $(1) ===\033[0m\n"
endef

define log_end_section
	@printf "\033[32m=============================================\033[0m\n"
endef

define bootstrap_regions
	$(call log_section,Bootstrapping CDK in Tokyo region)
	$(CDK) bootstrap aws://$(AWS_ACCOUNT_ID)/$(REGION_TOKYO) \
		--cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess \
		--trust $(AWS_ACCOUNT_ID) \
		--force \
		--verbose
	$(call log_end_section)
endef

define check_failed_stacks
	$(call log_section,Checking for failed CloudFormation stacks)
	@aws cloudformation list-stacks \
		--region $(REGION_TOKYO) \
		--query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE` && StackStatus!=`CREATE_COMPLETE` && StackStatus!=`UPDATE_COMPLETE`].[StackName,StackStatus,StackStatusReason]' \
		--output table || true
	$(call log_end_section)
endef

define send_notification
	$(call log_section,Sending notification)
	@node ../../script/invoke-lambda/send_notification.js "$(1)"
	$(call log_end_section)
endef

# ===========================================
# Main Commands
# ===========================================
.PHONY: deploy destroy notify-test bootstrap check-stacks first-deploy reset-deploy

# Test notification system
notify-test:
	$(call send_notification,$(NOTIFY_TEST))

# Bootstrap AWS environment
bootstrap:
	$(call bootstrap_regions)

# Check failed stacks
check-stacks:
	$(call check_failed_stacks)

# First time deployment with bootstrap
first-deploy: bootstrap
	$(call log_section,First time deployment)
	$(CDK) deploy $(MAIN_STACK) $(DEPLOY_FLAGS)
	$(call send_notification,$(NOTIFY_FIRST_DEPLOY))
	$(call log_section,First deployment completed successfully)
	$(call log_end_section)

# Reset and redeploy all stacks
reset-deploy:
	$(call log_section,Starting full reset and redeploy)
	$(MAKE) destroy
	$(call log_section,Starting fresh deployment)
	$(MAKE) first-deploy
	$(call send_notification,$(NOTIFY_RESET_DEPLOY))
	$(call log_section,Reset and redeploy completed successfully)
	$(call log_end_section)

# Deploy stack
deploy: bootstrap
	$(call log_section,Deploying main stack)
	$(CDK) deploy $(MAIN_STACK) $(DEPLOY_FLAGS)
	$(call send_notification,$(NOTIFY_DEPLOY))
	$(call log_section,Deployment completed successfully)
	$(call log_end_section)

# Destroy stack
destroy: bootstrap check-stacks
	$(call log_section,Destroying stacks)
	-$(CDK) destroy $(MAIN_STACK) $(DESTROY_FLAGS)
	$(call send_notification,$(NOTIFY_DESTROY))
	$(call log_section,Destroy process completed)
	$(call log_end_section)