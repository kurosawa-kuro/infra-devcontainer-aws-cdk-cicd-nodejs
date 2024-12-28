#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkGlueAthenaStack } from '../lib/infra-aws-cdk-glue-athena-stack';

const app = new cdk.App();
new InfraAwsCdkGlueAthenaStack(app, 'InfraAwsCdkGlueAthenaStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});