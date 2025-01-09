#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsCdkMonitoringStack } from '../lib/aws-cdk-monitoring-stack';

// Configuration interface
interface MonitoringConfig {
  readonly region: string;
  readonly environment: string;
}

// EC2 specific configuration
interface EC2Config {
  readonly instanceId: string;
  readonly imageId: string;
  readonly instanceType: string;
}

// Fargate specific configuration
interface FargateConfig {
  readonly clusterName: string;
  readonly serviceName: string;
}

// Default configurations
const defaultConfig: MonitoringConfig = {
  region: 'ap-northeast-1',
  environment: 'prod',
};

const EC2_INSTANCE_ID='i-1234567890abcdef0'
const EC2_IMAGE_ID="ami-1234567890abcdef0"
const EC2_INSTANCE_TYPE="t3.small"
const FARGATE_CLUSTER_NAME="production-cluster" 
const FARGATE_SERVICE_NAME="web-service"

const ec2Config: EC2Config = {
  instanceId: process.env.EC2_INSTANCE_ID || EC2_INSTANCE_ID,
  imageId: process.env.EC2_IMAGE_ID || EC2_IMAGE_ID,
  instanceType: process.env.EC2_INSTANCE_TYPE || EC2_INSTANCE_TYPE,
};

const fargateConfig: FargateConfig = {
  clusterName: process.env.FARGATE_CLUSTER_NAME || FARGATE_CLUSTER_NAME,
  serviceName: process.env.FARGATE_SERVICE_NAME || FARGATE_SERVICE_NAME,
};

const app = new cdk.App();

// EC2 Monitoring Stack
new AwsCdkMonitoringStack(app, 'EC2Monitoring', {
  env: { region: defaultConfig.region },
  isEc2: true,
  instanceId: ec2Config.instanceId,
  imageId: ec2Config.imageId,
  instanceType: ec2Config.instanceType,
  environment: defaultConfig.environment,
});

// Fargate Monitoring Stack
new AwsCdkMonitoringStack(app, 'FargateMonitoring', {
  env: { region: defaultConfig.region },
  isEc2: false,
  clusterName: fargateConfig.clusterName,
  serviceName: fargateConfig.serviceName,
  environment: defaultConfig.environment,
});