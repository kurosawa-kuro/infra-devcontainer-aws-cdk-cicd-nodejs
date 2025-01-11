# ===========================================
# Configuration Layer
# ===========================================
# AWS Configuration
AWS_ACCOUNT_ID = 985539793438
REGION_TOKYO = ap-northeast-1

# CDK Configuration
CDK = cdk
DEPLOY_FLAGS = --require-approval never
DESTROY_FLAGS = --force --debug

# Stack Configuration
MAIN_STACK = AwsCdkWebBasicStack

# Notification Configuration
NOTIFY_PREFIX = [INFO]
NOTIFY_MESSAGES = { \
    deploy: "$(NOTIFY_PREFIX)_Deployment_completed", \
    destroy: "$(NOTIFY_PREFIX)_Stack_destruction_completed", \
    first_deploy: "$(NOTIFY_PREFIX)_First_deployment_completed", \
    reset_deploy: "$(NOTIFY_PREFIX)_Reset_and_redeploy_completed" \
}

# ===========================================
# Utility Layer
# ===========================================
# Logging Utilities
define log_section
	@printf "\033[32m=== $(1) ===\033[0m\n"
endef

define log_end_section
	@printf "\033[32m=============================================\033[0m\n"
endef

# AWS Operation Utilities
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

# Notification Utility
define send_notification
	$(call log_section,Sending notification)
	@cd ../../script/invoke-lambda && AWS_REGION=$(REGION_TOKYO) node send_notification.js '$(1)'
	$(call log_end_section)
endef

# ===========================================
# Operation Layer
# ===========================================
.PHONY: first-deploy reset-deploy destroy test-slack-notification

# Primary Operations
first-deploy:
	$(call log_section,First time deployment)
	$(call bootstrap_regions)
	$(CDK) deploy $(MAIN_STACK) $(DEPLOY_FLAGS)
	$(call send_notification,"[INFO] First deployment completed successfully 🚀")
	$(call log_section,First deployment completed successfully)
	$(call log_end_section)

reset-deploy:
	$(call log_section,Starting full reset and redeploy)
	$(MAKE) destroy
	$(call log_section,Starting fresh deployment)
	$(MAKE) first-deploy
	$(call send_notification,"[INFO] Reset and redeploy completed successfully ♻️")
	$(call log_section,Reset and redeploy completed successfully)
	$(call log_end_section)

destroy:
	$(call log_section,Destroying stacks)
	$(call bootstrap_regions)
	$(call check_failed_stacks)
	-$(CDK) destroy $(MAIN_STACK) $(DESTROY_FLAGS)
	$(call send_notification,"[INFO] Stack destruction completed successfully 🗑️")
	$(call log_section,Destroy process completed)
	$(call log_end_section)

# Testing Operations
test-slack-notification:
	$(call log_section,Testing Slack Notification Lambda)
	$(call send_notification,"[TEST] From AWS CDK Web Basic Stack Notification Test: Success 🎉")
	$(call log_section,Testing Slack Notification Lambda completed)
	$(call log_end_section)
