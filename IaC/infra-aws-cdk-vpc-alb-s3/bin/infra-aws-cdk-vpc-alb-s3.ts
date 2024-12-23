#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkVpcAlbS3Stack } from '../lib/infra-aws-cdk-vpc-alb-s3-stack';

const app = new cdk.App();
new InfraAwsCdkVpcAlbS3Stack(app, 'InfraAwsCdkVpcAlbS3Stack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});