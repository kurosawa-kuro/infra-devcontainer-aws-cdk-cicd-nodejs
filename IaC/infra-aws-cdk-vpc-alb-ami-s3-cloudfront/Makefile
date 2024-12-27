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
WAF_STACK = $(PREFIX)-WebAclStack
WAF_NAME = $(PREFIX)-cf-waf
CDK_TOOLKIT = CDKToolkit
CDK_ASSETS_BUCKET = cdk-hnb659fds-assets-$(AWS_ACCOUNT_ID)

# ===========================================
# Helper Macros
# ===========================================
# AWS CLI command wrapper with region
define aws_cmd
	aws $(1) --region $(2) $(3)
endef

# Wait for stack operation completion
define wait_stack
	-aws cloudformation wait stack-$(1)-complete --stack-name $(2) --region $(3) || true
endef

# Delete stack with retain resources if needed
define delete_stack_safely
	@if $(call aws_cmd,cloudformation,$(2),list-stacks --query 'StackSummaries[?StackName==`$(1)` && StackStatus==`DELETE_FAILED`].[StackName]' --output text) | grep -q .; then \
		echo "Stack $(1) is in DELETE_FAILED state, using --retain-resources..."; \
		$(call aws_cmd,cloudformation,$(2),list-stack-resources --stack-name $(1) \
			--query 'StackResourceSummaries[?ResourceStatus!=`DELETE_COMPLETE`].LogicalResourceId' \
			--output text > /tmp/resources_$(1).txt || true); \
		$(call aws_cmd,cloudformation,$(2),delete-stack --stack-name $(1) \
			--retain-resources $$(cat /tmp/resources_$(1).txt 2>/dev/null || echo "")); \
	else \
		echo "Stack $(1) is not in DELETE_FAILED state, performing normal delete..."; \
		$(call aws_cmd,cloudformation,$(2),delete-stack --stack-name $(1)); \
	fi
	$(call wait_stack,delete,$(1),$(2))
endef

# Check stacks in region
define check_stacks
	@echo "Checking stacks in $(1):"
	@$(call aws_cmd,cloudformation,$(1),list-stacks \
		--query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].[StackName,StackStatus]' \
		--output table)
endef

# ===========================================
# Main Deployment Commands
# ===========================================
.PHONY: first-deploy reset-deploy destroy clean-bootstrap delete-webacl check-failed-stacks force-delete-failed

# Check failed stacks in both regions
check-failed-stacks:
	@echo "Checking failed stacks in $(REGION_TOKYO)..."
	@$(call aws_cmd,cloudformation,$(REGION_TOKYO),list-stacks \
		--query 'StackSummaries[?contains(StackStatus, `FAILED`)].[StackName,StackStatus]' \
		--output table)
	@echo "\nChecking failed stacks in $(REGION_VIRGINIA)..."
	@$(call aws_cmd,cloudformation,$(REGION_VIRGINIA),list-stacks \
		--query 'StackSummaries[?contains(StackStatus, `FAILED`)].[StackName,StackStatus]' \
		--output table)

# Delete WebACL stack explicitly
delete-webacl:
	$(call delete_stack_safely,$(WAF_STACK),$(REGION_VIRGINIA))
	-$(call aws_cmd,wafv2,$(REGION_VIRGINIA),list-web-acls --scope CLOUDFRONT \
		--query 'WebACLs[?Name==`$(WAF_NAME)`].[Id,Name]' --output text) | while read id name; do \
		$(call aws_cmd,wafv2,$(REGION_VIRGINIA),delete-web-acl --name $$name --scope CLOUDFRONT --id $$id \
		--lock-token $$(aws wafv2 get-web-acl --name $$name --scope CLOUDFRONT --region $(REGION_VIRGINIA) --id $$id --query 'LockToken' --output text)); \
	done || true
	sleep 10

# Clean CDK bootstrap resources
clean-bootstrap:
	-aws s3 rb s3://$(CDK_ASSETS_BUCKET)-$(REGION_TOKYO) --force || true
	-aws s3 rb s3://$(CDK_ASSETS_BUCKET)-$(REGION_VIRGINIA) --force || true
	sleep 10
	-aws iam delete-role --role-name cdk-hnb659fds-cfn-exec-role-$(AWS_ACCOUNT_ID)-$(REGION_TOKYO) || true
	-aws iam delete-role --role-name cdk-hnb659fds-cfn-exec-role-$(AWS_ACCOUNT_ID)-$(REGION_VIRGINIA) || true
	$(call delete_stack_safely,$(CDK_TOOLKIT),$(REGION_TOKYO))
	$(call delete_stack_safely,$(CDK_TOOLKIT),$(REGION_VIRGINIA))
	sleep 10

# Bootstrap both regions and deploy all stacks
first-deploy:
	$(CDK) bootstrap aws://$(AWS_ACCOUNT_ID)/$(REGION_TOKYO) aws://$(AWS_ACCOUNT_ID)/$(REGION_VIRGINIA) && \
	$(CDK) deploy --all $(DEPLOY_FLAGS)

# Force delete failed stacks
force-delete-failed:
	$(call delete_stack_safely,$(MAIN_STACK),$(REGION_TOKYO))
	$(call delete_stack_safely,$(WAF_STACK),$(REGION_VIRGINIA))
	@echo "Waiting for deletions to complete..."
	sleep 10
	@echo "Verifying deletions..."
	@! $(call aws_cmd,cloudformation,$(REGION_TOKYO),list-stacks \
		--query 'StackSummaries[?contains(StackStatus, `FAILED`)].[StackName,StackStatus]' \
		--output text) | grep -q "." || (echo "Failed stacks still exist in $(REGION_TOKYO)" && exit 1)
	@! $(call aws_cmd,cloudformation,$(REGION_VIRGINIA),list-stacks \
		--query 'StackSummaries[?contains(StackStatus, `FAILED`)].[StackName,StackStatus]' \
		--output text) | grep -q "." || (echo "Failed stacks still exist in $(REGION_VIRGINIA)" && exit 1)
	@echo "All failed stacks have been successfully deleted."

# Clean up everything and redeploy
reset-deploy: check-failed-stacks force-delete-failed delete-webacl nuke-all clean-bootstrap first-deploy

# Destroy all stacks
destroy:
	$(CDK) destroy --all $(DESTROY_FLAGS)

# ===========================================
# Resource Cleanup Commands
# ===========================================
.PHONY: nuke-all force-delete-stack-resources

# Force delete all resources and stacks
nuke-all:
	# EC2 Resources
	-$(call aws_cmd,ec2,$(REGION_TOKYO),describe-instances \
		--query 'Reservations[*].Instances[*].[InstanceId]' --output text) | \
		xargs -I {} $(call aws_cmd,ec2,$(REGION_TOKYO),terminate-instances --instance-ids {}) || true
	
	# Load Balancers
	-$(call aws_cmd,elbv2,$(REGION_TOKYO),describe-load-balancers \
		--query 'LoadBalancers[*].[LoadBalancerArn]' --output text) | \
		xargs -I {} $(call aws_cmd,elbv2,$(REGION_TOKYO),delete-load-balancer --load-balancer-arn {}) || true
	
	# Security Groups
	-$(call aws_cmd,ec2,$(REGION_TOKYO),describe-security-groups \
		--query 'SecurityGroups[?GroupName!=`default`].[GroupId]' --output text) | \
		xargs -I {} $(call aws_cmd,ec2,$(REGION_TOKYO),delete-security-group --group-id {}) || true
	
	# S3 Buckets
	for region in $(REGION_TOKYO) $(REGION_VIRGINIA); do \
		bucket=$(CDK_ASSETS_BUCKET)-$$region; \
		aws s3api list-object-versions --bucket $$bucket \
			--query 'Versions[].{Key:Key,VersionId:VersionId}' --output text 2>/dev/null | \
			while read key versionid; do \
				aws s3api delete-object --bucket $$bucket --key $$key --version-id $$versionid; \
			done || true; \
		aws s3api list-object-versions --bucket $$bucket \
			--query 'DeleteMarkers[].{Key:Key,VersionId:VersionId}' --output text 2>/dev/null | \
			while read key versionid; do \
				aws s3api delete-object --bucket $$bucket --key $$key --version-id $$versionid; \
			done || true; \
		aws s3api delete-bucket --bucket $$bucket || true; \
	done
	
	# CloudFront and WAF
	-$(call aws_cmd,cloudfront,,list-distributions --query 'DistributionList.Items[*].[Id]' --output text) | \
		xargs -I {} aws cloudfront delete-distribution --id {} \
		--if-match $$(aws cloudfront get-distribution --id {} --query 'ETag' --output text) || true
	
	-$(call aws_cmd,wafv2,$(REGION_VIRGINIA),list-web-acls --scope CLOUDFRONT \
		--query 'WebACLs[*].[Id,Name]' --output text) | while read id name; do \
		$(call aws_cmd,wafv2,$(REGION_VIRGINIA),delete-web-acl --name $$name --scope CLOUDFRONT --id $$id \
		--lock-token $$(aws wafv2 get-web-acl --name $$name --scope CLOUDFRONT --region $(REGION_VIRGINIA) --id $$id --query 'LockToken' --output text)); \
	done || true
	
	# Force delete all stacks
	for region in $(REGION_TOKYO) $(REGION_VIRGINIA); do \
		$(call aws_cmd,cloudformation,$$region,list-stacks \
			--query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].[StackName]' --output text) | \
		xargs -I {} $(call aws_cmd,cloudformation,$$region,delete-stack --stack-name {}) || true; \
	done
	
	sleep 30
	$(call check_stacks,$(REGION_TOKYO))
	$(call check_stacks,$(REGION_VIRGINIA))

# Force delete stack resources
force-delete-stack-resources:
	# Network Resources
	for cmd in \
		"ec2 describe-internet-gateways --filters Name=tag:aws:cloudformation:stack-name,Values=* --query 'InternetGateways[*].[InternetGatewayId,Attachments[0].VpcId]' --output text | while read igw vpc; do aws ec2 detach-internet-gateway --internet-gateway-id \$$igw --vpc-id \$$vpc --region $(REGION_TOKYO); done" \
		"ec2 describe-internet-gateways --filters Name=tag:aws:cloudformation:stack-name,Values=* --query 'InternetGateways[*].[InternetGatewayId]' --output text | xargs -I {} aws ec2 delete-internet-gateway --internet-gateway-id {} --region $(REGION_TOKYO)" \
		"ec2 describe-route-tables --filters Name=tag:aws:cloudformation:stack-name,Values=* --query 'RouteTables[*].Associations[?!Main].[RouteTableAssociationId]' --output text | xargs -I {} aws ec2 disassociate-route-table --association-id {} --region $(REGION_TOKYO)" \
		"ec2 describe-route-tables --filters Name=tag:aws:cloudformation:stack-name,Values=* --query 'RouteTables[?Associations[0].Main!=`true`].[RouteTableId]' --output text | xargs -I {} aws ec2 delete-route-table --route-table-id {} --region $(REGION_TOKYO)" \
		"ec2 describe-network-interfaces --filters Name=tag:aws:cloudformation:stack-name,Values=* --query 'NetworkInterfaces[*].[NetworkInterfaceId]' --output text | xargs -I {} aws ec2 delete-network-interface --network-interface-id {} --region $(REGION_TOKYO)" \
		"ec2 describe-security-groups --filters Name=tag:aws:cloudformation:stack-name,Values=* --query 'SecurityGroups[?GroupName!=`default`].[GroupId]' --output text | xargs -I {} aws ec2 delete-security-group --group-id {} --region $(REGION_TOKYO)" \
		"ec2 describe-subnets --filters Name=tag:aws:cloudformation:stack-name,Values=* --query 'Subnets[*].[SubnetId]' --output text | xargs -I {} aws ec2 delete-subnet --subnet-id {} --region $(REGION_TOKYO)" \
		"ec2 describe-vpcs --filters Name=tag:aws:cloudformation:stack-name,Values=* --query 'Vpcs[*].[VpcId]' --output text | xargs -I {} aws ec2 delete-vpc --vpc-id {} --region $(REGION_TOKYO)"; \
	do \
		eval "-aws $$cmd || true"; \
	done
	
	sleep 10

# ===========================================
# Development Commands
# ===========================================
.PHONY: init

# Initialize new CDK TypeScript app
init:
	$(CDK) init app --language typescript 