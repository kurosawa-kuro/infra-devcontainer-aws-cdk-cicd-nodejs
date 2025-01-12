#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsErrorNotificationStack } from '../lib/aws-error-notification-stack';

const app = new cdk.App();
new AwsErrorNotificationStack(app, 'AwsErrorNotificationStack', {
  env: { region: 'ap-northeast-1' },
});