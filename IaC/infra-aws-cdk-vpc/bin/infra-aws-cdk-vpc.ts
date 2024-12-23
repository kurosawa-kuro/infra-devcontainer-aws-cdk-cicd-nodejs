#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkVpcStack } from '../lib/infra-aws-cdk-vpc-stack';

const app = new cdk.App();
new InfraAwsCdkVpcStack(app, 'InfraAwsCdkVpcStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});