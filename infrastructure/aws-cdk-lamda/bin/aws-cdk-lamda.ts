#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsCdkLamdaStack } from '../lib/aws-cdk-lamda-stack';

const app = new cdk.App();

// Get function name from context or use default
const functionName = app.node.tryGetContext('functionName') || 'slack-notification';

new AwsCdkLamdaStack(app, 'AwsCdkLamdaStack', {
  env: { region: 'ap-northeast-1' },
  functionName: functionName,
});