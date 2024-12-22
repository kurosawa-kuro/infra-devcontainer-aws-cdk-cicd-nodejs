import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class InfraAwsCdkVpcAlbS3CfRmonitorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'InfraAwsCdkVpcAlbS3CfRmonitorQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
  }
}
