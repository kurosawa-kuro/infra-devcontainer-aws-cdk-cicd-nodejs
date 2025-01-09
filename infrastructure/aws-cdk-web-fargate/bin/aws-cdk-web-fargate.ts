#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsCdkWebFargateStack } from '../lib/aws-cdk-web-fargate-stack';

const app = new cdk.App();
new AwsCdkWebFargateStack(app, 'AwsCdkWebFargateStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});