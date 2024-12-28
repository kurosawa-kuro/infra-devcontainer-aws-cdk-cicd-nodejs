#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsCdkWebBasicStack } from '../lib/aws-cdk-web-basic-stack';
import { DestroyAwsCdkWebBasicStack } from '../lib/destroy-aws-cdk-web-basic-stack';

const app = new cdk.App();

new AwsCdkWebBasicStack(app, 'AwsCdkWebBasicStack', {
  env: { region: 'ap-northeast-1' }
});

new DestroyAwsCdkWebBasicStack(app, 'DestroyAwsCdkWebBasicStack', {
  env: { region: 'ap-northeast-1' }
});

app.synth();