#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkVpcAlbS3CfRmonitorStack } from '../lib/infra-aws-cdk-vpc-alb-s3-cf-rmonitor-stack';

const app = new cdk.App();
new InfraAwsCdkVpcAlbS3CfRmonitorStack(app, 'InfraAwsCdkVpcAlbS3CfRmonitorStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});