#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkVpcAlbAmiS3CloudfrontCloudwatchStack } from '../lib/infra-aws-cdk-vpc-alb-ami-s3-cloudfront-cloudwatch-stack';

const app = new cdk.App();
new InfraAwsCdkVpcAlbAmiS3CloudfrontCloudwatchStack(app, 'InfraAwsCdkVpcAlbAmiS3CloudfrontCloudwatchStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});