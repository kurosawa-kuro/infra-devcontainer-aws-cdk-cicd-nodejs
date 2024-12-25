#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkVpcAlbAmiS3CloudfrontStack } from '../lib/infra-aws-cdk-vpc-alb-ami-s3-cloudfront-stack';

const app = new cdk.App();
new InfraAwsCdkVpcAlbAmiS3CloudfrontStack(app, 'InfraAwsCdkVpcAlbAmiS3CloudfrontStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});