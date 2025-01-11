# ===========================================
# AWS and CDK Configuration
# ===========================================
AWS_ACCOUNT_ID = 985539793438
REGION_TOKYO = ap-northeast-1

# ===========================================
# CDK Command Settings
# ===========================================
CDK = cdk
DEPLOY_FLAGS = --require-approval never
DESTROY_FLAGS = --force --debug

# ===========================================
# Stack Names
# ===========================================
MAIN_STACK = AwsCdkWebBasicStack

# ===========================================
# Notification Messages
# ===========================================
NOTIFY_PREFIX = [INFO]
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
		--force
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
.PHONY: first-deploy reset-deploy destroy test-slack-notification

# First time deployment with bootstrap
first-deploy:
	$(call log_section,First time deployment)
	$(call bootstrap_regions)
	$(CDK) deploy $(MAIN_STACK) $(DEPLOY_FLAGS)
	cd ../../script/invoke-lambda && \
		AWS_REGION=$(REGION_TOKYO) \
		node send_notification.js \
		"[INFO] First deployment completed successfully 🚀"
	$(call log_section,First deployment completed successfully)
	$(call log_end_section)

# Reset and redeploy all stacks
reset-deploy:
	$(call log_section,Starting full reset and redeploy)
	$(MAKE) destroy
	$(call log_section,Starting fresh deployment)
	$(MAKE) first-deploy
	cd ../../script/invoke-lambda && \
		AWS_REGION=$(REGION_TOKYO) \
		node send_notification.js \
		"[INFO] Reset and redeploy completed successfully ♻️"
	$(call log_section,Reset and redeploy completed successfully)
	$(call log_end_section)

# Destroy stack
destroy:
	$(call log_section,Destroying stacks)
	$(call bootstrap_regions)
	$(call check_failed_stacks)
	-$(CDK) destroy $(MAIN_STACK) $(DESTROY_FLAGS)
	cd ../../script/invoke-lambda && \
		AWS_REGION=$(REGION_TOKYO) \
		node send_notification.js \
		"[INFO] Stack destruction completed successfully 🗑️"
	$(call log_section,Destroy process completed)
	$(call log_end_section)

# slack-notificationのテスト
test-slack-notification:
	cd ../../script/invoke-lambda && \
		AWS_REGION=$(REGION_TOKYO) \
		node send_notification.js \
		"New Lambda Function Test: Success 🎉"

# slack-notification
test-slack-notification:
	cd ../../script/invoke-lambda && \
		AWS_REGION=$(REGION_TOKYO) \
		node send_notification.js \
		"AAAAAAAAA"