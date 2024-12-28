#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraAwsCdkVpcAlbAmiS3CloudfrontStack } from '../lib/infra-aws-cdk-vpc-alb-ami-s3-cloudfront-stack';
import { DestroyStack } from '../lib/destroy-stack';

const app = new cdk.App();

new InfraAwsCdkVpcAlbAmiS3CloudfrontStack(app, 'InfraAwsCdkVpcAlbAmiS3CloudfrontStack', {
  env: { region: 'ap-northeast-1' }
});

new DestroyStack(app, 'DestroyStack', {
  env: { region: 'ap-northeast-1' }
});

app.synth();