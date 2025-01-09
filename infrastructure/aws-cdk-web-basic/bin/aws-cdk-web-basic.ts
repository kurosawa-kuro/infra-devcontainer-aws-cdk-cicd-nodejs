#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsCdkWebBasicStack } from '../lib/aws-cdk-web-basic-stack';

const app = new cdk.App();

const mainStack = new AwsCdkWebBasicStack(app, 'AwsCdkWebBasicStack', {
  env: { region: 'ap-northeast-1' },
});