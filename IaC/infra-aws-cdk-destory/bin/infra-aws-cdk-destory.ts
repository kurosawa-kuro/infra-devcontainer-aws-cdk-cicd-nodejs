#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkDestoryStack } from '../lib/infra-aws-cdk-destory-stack';

const app = new cdk.App();
new InfraAwsCdkDestoryStack(app, 'InfraAwsCdkDestoryStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});