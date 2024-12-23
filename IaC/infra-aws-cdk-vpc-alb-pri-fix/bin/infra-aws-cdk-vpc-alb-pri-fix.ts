#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkVpcAlbPriFixStack } from '../lib/infra-aws-cdk-vpc-alb-pri-fix-stack';

const app = new cdk.App();
new InfraAwsCdkVpcAlbPriFixStack(app, 'InfraAwsCdkVpcAlbPriFixStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});