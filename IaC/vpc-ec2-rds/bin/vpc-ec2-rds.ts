#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VpcEc2RdsStack } from '../lib/vpc-ec2-rds-stack';

const app = new cdk.App();
new VpcEc2RdsStack(app, 'VpcEc2RdsStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});