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
# Main Deployment Commands
# ===========================================
.PHONY: first-deploy reset-deploy destroy clean-bootstrap

# Clean CDK bootstrap resources and redeploy
clean-bootstrap:
	# Delete CDK assets bucket in both regions first
	-aws s3 rb s3://$(CDK_ASSETS_BUCKET)-$(REGION_TOKYO) --force || true
	-aws s3 rb s3://$(CDK_ASSETS_BUCKET)-$(REGION_VIRGINIA) --force || true
	# Wait a moment for S3 deletion to propagate
	sleep 10
	# Delete CloudFormation execution roles in both regions
	-aws iam delete-role --role-name cdk-hnb659fds-cfn-exec-role-$(AWS_ACCOUNT_ID)-$(REGION_TOKYO) || true
	-aws iam delete-role --role-name cdk-hnb659fds-cfn-exec-role-$(AWS_ACCOUNT_ID)-$(REGION_VIRGINIA) || true
	# Delete CDKToolkit stacks in both regions
	-aws cloudformation delete-stack --stack-name $(CDK_TOOLKIT) --region $(REGION_TOKYO)
	-aws cloudformation delete-stack --stack-name $(CDK_TOOLKIT) --region $(REGION_VIRGINIA)
	-aws cloudformation wait stack-delete-complete --stack-name $(CDK_TOOLKIT) --region $(REGION_TOKYO)
	-aws cloudformation wait stack-delete-complete --stack-name $(CDK_TOOLKIT) --region $(REGION_VIRGINIA)
	# Wait for stack deletion to complete
	sleep 10

# Bootstrap both regions and deploy all stacks
first-deploy:
	# Delete WebACL stack if it exists in DELETE_FAILED state
	-aws cloudformation delete-stack --stack-name $(WAF_STACK) --region $(REGION_VIRGINIA)
	-aws cloudformation wait stack-delete-complete --stack-name $(WAF_STACK) --region $(REGION_VIRGINIA)
	sleep 10
	$(CDK) bootstrap aws://$(AWS_ACCOUNT_ID)/$(REGION_TOKYO) aws://$(AWS_ACCOUNT_ID)/$(REGION_VIRGINIA) && \
	$(CDK) deploy --all $(DEPLOY_FLAGS)

# Clean up everything and redeploy
reset-deploy:
	$(MAKE) force-delete-stack-resources && $(MAKE) nuke-all && $(MAKE) clean-bootstrap && $(MAKE) first-deploy

# Destroy all stacks
destroy:
	$(CDK) destroy --all $(DESTROY_FLAGS)

# ===========================================
# Cleanup and Management Commands
# ===========================================
.PHONY: force-cleanup-all force-delete-stack force-delete-failed-stacks

# Force delete a specific stack
force-delete-stack:
	@if [ -z "$(STACK)" ]; then \
		echo "Usage: make force-delete-stack STACK=<stack-name> [REGION=<region>]"; \
		exit 1; \
	fi
	aws cloudformation delete-stack \
		--stack-name $(STACK) \
		--region $${REGION:-$(REGION_VIRGINIA)}
	aws cloudformation wait stack-delete-complete \
		--stack-name $(STACK) \
		--region $${REGION:-$(REGION_VIRGINIA)}

# Force delete all failed stacks without role assumption
force-delete-failed-stacks:
	# Delete stacks in Tokyo region with retain-resources
	-aws cloudformation list-stack-resources --stack-name InfraAwsCdkVpcStack --region $(REGION_TOKYO) --query 'StackResourceSummaries[*].LogicalResourceId' --output text > /tmp/resources.txt || true
	-aws cloudformation delete-stack --stack-name InfraAwsCdkVpcStack --region $(REGION_TOKYO) --retain-resources $$(cat /tmp/resources.txt)
	
	-aws cloudformation list-stack-resources --stack-name InfraAwsCdkVpcAlbPriStack --region $(REGION_TOKYO) --query 'StackResourceSummaries[*].LogicalResourceId' --output text > /tmp/resources.txt || true
	-aws cloudformation delete-stack --stack-name InfraAwsCdkVpcAlbPriStack --region $(REGION_TOKYO) --retain-resources $$(cat /tmp/resources.txt)
	
	-aws cloudformation list-stack-resources --stack-name InfraAwsCdkVpcAlbPriFixStack --region $(REGION_TOKYO) --query 'StackResourceSummaries[*].LogicalResourceId' --output text > /tmp/resources.txt || true
	-aws cloudformation delete-stack --stack-name InfraAwsCdkVpcAlbPriFixStack --region $(REGION_TOKYO) --retain-resources $$(cat /tmp/resources.txt)
	
	-aws cloudformation list-stack-resources --stack-name InfraAwsCdkVpcAlbAmiS3CloudfrontStack --region $(REGION_TOKYO) --query 'StackResourceSummaries[*].LogicalResourceId' --output text > /tmp/resources.txt || true
	-aws cloudformation delete-stack --stack-name InfraAwsCdkVpcAlbAmiS3CloudfrontStack --region $(REGION_TOKYO) --retain-resources $$(cat /tmp/resources.txt)
	
	# Wait for all deletions to complete
	-aws cloudformation wait stack-delete-complete --stack-name InfraAwsCdkVpcStack --region $(REGION_TOKYO)
	-aws cloudformation wait stack-delete-complete --stack-name InfraAwsCdkVpcAlbPriStack --region $(REGION_TOKYO)
	-aws cloudformation wait stack-delete-complete --stack-name InfraAwsCdkVpcAlbPriFixStack --region $(REGION_TOKYO)
	-aws cloudformation wait stack-delete-complete --stack-name InfraAwsCdkVpcAlbAmiS3CloudfrontStack --region $(REGION_TOKYO)
	
	# Check remaining stacks
	@echo "Checking remaining stacks in $(REGION_TOKYO):"
	@aws cloudformation list-stacks --region $(REGION_TOKYO) \
		--query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].[StackName,StackStatus]' \
		--output table

# Complete cleanup of all resources
force-cleanup-all:
	# Delete CloudFront distribution stack
	-aws cloudformation delete-stack --stack-name $(MAIN_STACK) --region $(REGION_TOKYO)
	-aws cloudformation wait stack-delete-complete --stack-name $(MAIN_STACK) --region $(REGION_TOKYO)

	# Delete WAF WebACL stackInfraAwsCdkVpcAlbPriStack
	-aws cloudformation delete-stack --stack-name $(WAF_STACK) --region $(REGION_VIRGINIA)
	-aws cloudformation wait stack-delete-complete --stack-name $(WAF_STACK) --region $(REGION_VIRGINIA)

	# Check remaining stacks
	@echo "Checking remaining stacks in $(REGION_TOKYO):"
	@aws cloudformation list-stacks --region $(REGION_TOKYO) \
		--query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].[StackName,StackStatus]' \
		--output table
	@echo "Checking remaining stacks in $(REGION_VIRGINIA):"
	@aws cloudformation list-stacks --region $(REGION_VIRGINIA) \
		--query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].[StackName,StackStatus]' \
		--output table

# ===========================================
# Development Commands
# ===========================================
.PHONY: init

# Initialize new CDK TypeScript app
init:
	$(CDK) init app --language typescript 

# Force delete all resources and stacks
nuke-all:
	# Delete EC2 instances
	-aws ec2 describe-instances --region $(REGION_TOKYO) --query 'Reservations[*].Instances[*].[InstanceId]' --output text | xargs -I {} aws ec2 terminate-instances --instance-ids {} --region $(REGION_TOKYO) || true
	
	# Delete ALBs
	-aws elbv2 describe-load-balancers --region $(REGION_TOKYO) --query 'LoadBalancers[*].[LoadBalancerArn]' --output text | xargs -I {} aws elbv2 delete-load-balancer --load-balancer-arn {} --region $(REGION_TOKYO) || true
	
	# Delete Security Groups (except default)
	-aws ec2 describe-security-groups --region $(REGION_TOKYO) --query 'SecurityGroups[?GroupName!=`default`].[GroupId]' --output text | xargs -I {} aws ec2 delete-security-group --group-id {} --region $(REGION_TOKYO) || true
	
	# Delete S3 buckets and their contents
	# Tokyo region
	-aws s3api list-object-versions --bucket $(CDK_ASSETS_BUCKET)-$(REGION_TOKYO) --query 'Versions[].{Key:Key,VersionId:VersionId}' --output text | while read key versionid; do aws s3api delete-object --bucket $(CDK_ASSETS_BUCKET)-$(REGION_TOKYO) --key $$key --version-id $$versionid; done || true
	-aws s3api list-object-versions --bucket $(CDK_ASSETS_BUCKET)-$(REGION_TOKYO) --query 'DeleteMarkers[].{Key:Key,VersionId:VersionId}' --output text | while read key versionid; do aws s3api delete-object --bucket $(CDK_ASSETS_BUCKET)-$(REGION_TOKYO) --key $$key --version-id $$versionid; done || true
	-aws s3api delete-bucket --bucket $(CDK_ASSETS_BUCKET)-$(REGION_TOKYO) || true
	
	# Virginia region
	-aws s3api list-object-versions --bucket $(CDK_ASSETS_BUCKET)-$(REGION_VIRGINIA) --query 'Versions[].{Key:Key,VersionId:VersionId}' --output text | while read key versionid; do aws s3api delete-object --bucket $(CDK_ASSETS_BUCKET)-$(REGION_VIRGINIA) --key $$key --version-id $$versionid; done || true
	-aws s3api list-object-versions --bucket $(CDK_ASSETS_BUCKET)-$(REGION_VIRGINIA) --query 'DeleteMarkers[].{Key:Key,VersionId:VersionId}' --output text | while read key versionid; do aws s3api delete-object --bucket $(CDK_ASSETS_BUCKET)-$(REGION_VIRGINIA) --key $$key --version-id $$versionid; done || true
	-aws s3api delete-bucket --bucket $(CDK_ASSETS_BUCKET)-$(REGION_VIRGINIA) || true
	
	# Delete CloudFront distributions
	-aws cloudfront list-distributions --query 'DistributionList.Items[*].[Id]' --output text | xargs -I {} aws cloudfront delete-distribution --id {} --if-match $(aws cloudfront get-distribution --id {} --query 'ETag' --output text) || true
	
	# Delete WAF WebACLs
	-aws wafv2 list-web-acls --scope CLOUDFRONT --region $(REGION_VIRGINIA) --query 'WebACLs[*].[Id,Name]' --output text | while read id name; do aws wafv2 delete-web-acl --name $$name --scope CLOUDFRONT --region $(REGION_VIRGINIA) --id $$id --lock-token $(aws wafv2 get-web-acl --name $$name --scope CLOUDFRONT --region $(REGION_VIRGINIA) --id $$id --query 'LockToken' --output text); done || true
	
	# Force delete all stacks
	-aws cloudformation list-stacks --region $(REGION_TOKYO) --query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].[StackName]' --output text | xargs -I {} aws cloudformation delete-stack --stack-name {} --region $(REGION_TOKYO) || true
	-aws cloudformation list-stacks --region $(REGION_VIRGINIA) --query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].[StackName]' --output text | xargs -I {} aws cloudformation delete-stack --stack-name {} --region $(REGION_VIRGINIA) || true
	
	# Wait for resources to be deleted
	sleep 30
	
	# Check remaining stacks
	@echo "Checking remaining stacks in $(REGION_TOKYO):"
	@aws cloudformation list-stacks --region $(REGION_TOKYO) --query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].[StackName,StackStatus]' --output table
	@echo "Checking remaining stacks in $(REGION_VIRGINIA):"
	@aws cloudformation list-stacks --region $(REGION_VIRGINIA) --query 'StackSummaries[?StackStatus!=`DELETE_COMPLETE`].[StackName,StackStatus]' --output table 

# Force delete stack resources
force-delete-stack-resources:
	# Detach Internet Gateways from VPCs
	-aws ec2 describe-internet-gateways --region $(REGION_TOKYO) --filters "Name=tag:aws:cloudformation:stack-name,Values=*" --query 'InternetGateways[*].[InternetGatewayId,Attachments[0].VpcId]' --output text | while read igw vpc; do aws ec2 detach-internet-gateway --internet-gateway-id $$igw --vpc-id $$vpc --region $(REGION_TOKYO); done || true
	
	# Delete Internet Gateways
	-aws ec2 describe-internet-gateways --region $(REGION_TOKYO) --filters "Name=tag:aws:cloudformation:stack-name,Values=*" --query 'InternetGateways[*].[InternetGatewayId]' --output text | xargs -I {} aws ec2 delete-internet-gateway --internet-gateway-id {} --region $(REGION_TOKYO) || true
	
	# Delete Route Table Associations
	-aws ec2 describe-route-tables --region $(REGION_TOKYO) --filters "Name=tag:aws:cloudformation:stack-name,Values=*" --query 'RouteTables[*].Associations[?!Main].[RouteTableAssociationId]' --output text | xargs -I {} aws ec2 disassociate-route-table --association-id {} --region $(REGION_TOKYO) || true
	
	# Delete Route Tables
	-aws ec2 describe-route-tables --region $(REGION_TOKYO) --filters "Name=tag:aws:cloudformation:stack-name,Values=*" --query 'RouteTables[?Associations[0].Main != `true`].[RouteTableId]' --output text | xargs -I {} aws ec2 delete-route-table --route-table-id {} --region $(REGION_TOKYO) || true
	
	# Delete Network Interfaces
	-aws ec2 describe-network-interfaces --region $(REGION_TOKYO) --filters "Name=tag:aws:cloudformation:stack-name,Values=*" --query 'NetworkInterfaces[*].[NetworkInterfaceId]' --output text | xargs -I {} aws ec2 delete-network-interface --network-interface-id {} --region $(REGION_TOKYO) || true
	
	# Delete Security Groups
	-aws ec2 describe-security-groups --region $(REGION_TOKYO) --filters "Name=tag:aws:cloudformation:stack-name,Values=*" --query 'SecurityGroups[?GroupName!=`default`].[GroupId]' --output text | xargs -I {} aws ec2 delete-security-group --group-id {} --region $(REGION_TOKYO) || true
	
	# Delete Subnets
	-aws ec2 describe-subnets --region $(REGION_TOKYO) --filters "Name=tag:aws:cloudformation:stack-name,Values=*" --query 'Subnets[*].[SubnetId]' --output text | xargs -I {} aws ec2 delete-subnet --subnet-id {} --region $(REGION_TOKYO) || true
	
	# Delete VPCs
	-aws ec2 describe-vpcs --region $(REGION_TOKYO) --filters "Name=tag:aws:cloudformation:stack-name,Values=*" --query 'Vpcs[*].[VpcId]' --output text | xargs -I {} aws ec2 delete-vpc --vpc-id {} --region $(REGION_TOKYO) || true
	
	# Wait for resources to be deleted
	sleep 10 