import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class InfraAwsCdkDestoryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 特定のプレフィックスを持つリソースを削除
    const prefix = 'cdk-training-01';

    // リソースの削除ポリシーを設定
    cdk.RemovalPolicy.DESTROY;

    // 例：S3バケットの削除設定
    new s3.Bucket(this, 'Bucket', {
      bucketName: `${prefix}-s3`,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // 強制削除
      autoDeleteObjects: true // バケット内のオブジェクトも削除
    });
  }
}
