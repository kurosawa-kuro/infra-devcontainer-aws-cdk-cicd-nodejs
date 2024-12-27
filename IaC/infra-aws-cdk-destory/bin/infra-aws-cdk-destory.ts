#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkDestoryStack } from '../lib/infra-aws-cdk-destory-stack';

const app = new cdk.App();
new InfraAwsCdkDestoryStack(app, 'cdk-express-01-DestroyStack', {
  prefix: 'cdk-express-01',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
  },
  description: 'Stack for cleaning up all resources',
});