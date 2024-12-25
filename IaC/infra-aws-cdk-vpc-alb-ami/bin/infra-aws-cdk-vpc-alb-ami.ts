#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkVpcAlbAmiStack } from '../lib/infra-aws-cdk-vpc-alb-ami-stack';

const app = new cdk.App();
new InfraAwsCdkVpcAlbAmiStack(app, 'InfraAwsCdkVpcAlbAmiStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});