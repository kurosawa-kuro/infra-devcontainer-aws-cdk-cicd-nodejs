#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkVpcAlbStack } from '../lib/infra-aws-cdk-vpc-alb-stack';

const app = new cdk.App();
new InfraAwsCdkVpcAlbStack(app, 'InfraAwsCdkVpcAlbStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});