#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkVpcAlbAmiS3CloudfrontStack } from '../lib/infra-aws-cdk-vpc-alb-ami-s3-cloudfront-stack';
import { DestroyStack } from '../lib/destroy-stack';

const app = new cdk.App();
new InfraAwsCdkVpcAlbAmiS3CloudfrontStack(app, 'InfraAwsCdkVpcAlbAmiS3CloudfrontStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});

new DestroyStack(app, 'DestroyStack', {
  prefix: 'cdk-express-01',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-northeast-1'
  }
});