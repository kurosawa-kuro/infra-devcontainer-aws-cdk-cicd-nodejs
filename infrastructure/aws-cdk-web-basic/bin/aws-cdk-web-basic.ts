#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsCdkWebBasicStack } from '../lib/aws-cdk-web-basic-stack';
import { DestroyStack } from '../lib/destroy-stack';

const app = new cdk.App();

const envConfig = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
};

new AwsCdkWebBasicStack(app, 'AwsCdkWebBasicStack', envConfig);
new DestroyStack(app, 'DestroyStack', envConfig);

app.synth();