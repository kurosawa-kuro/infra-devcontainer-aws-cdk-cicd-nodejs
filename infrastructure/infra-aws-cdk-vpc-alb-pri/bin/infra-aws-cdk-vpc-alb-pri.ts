#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkVpcAlbPriStack } from '../lib/infra-aws-cdk-vpc-alb-pri-stack';

const app = new cdk.App();
new InfraAwsCdkVpcAlbPriStack(app, 'InfraAwsCdkVpcAlbPriStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});