import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class InfraAwsCdkGlueAthenaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 既存のS3バケットを参照
    const existingLogBucket = s3.Bucket.fromBucketName(
      this,
      'ExistingLogBucket',
      'cdk-express-01-s3'
    );

    // Glueデータベースの作成
    const logsDatabase = new glue.CfnDatabase(this, 'LogsDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: 'cdk_express_01_logs'
      }
    });

    // Glueテーブルの作成
    const logsTable = new glue.CfnTable(this, 'LogsTable', {
      catalogId: this.account,
      databaseName: logsDatabase.ref,
      tableInput: {
        name: 'express_logs',
        storageDescriptor: {
          columns: [
            { name: 'timestamp', type: 'string' },
            { name: 'level', type: 'string' },
            { name: 'message', type: 'string' },
            { name: 'method', type: 'string' },
            { name: 'url', type: 'string' },
            { name: 'response_time', type: 'double' }
          ],
          location: `s3://${existingLogBucket.bucketName}/logs/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
            parameters: {
              'paths': 'timestamp,level,message,method,url,response_time'
            }
          }
        },
        parameters: {
          'classification': 'json',
          'jsonPath': '$.logs[*]'
        }
      }
    });

    // Athenaのクエリ結果用S3バケット
    const queryResultsBucket = new s3.Bucket(this, 'QueryResultsBucket', {
      bucketName: 'cdk-express-01-athena-results',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30)
        }
      ]
    });

    // Athenaワークグループの作成
    const workgroup = new athena.CfnWorkGroup(this, 'LogAnalyticsWorkgroup', {
      name: 'cdk-express-01-workgroup',
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${queryResultsBucket.bucketName}/`,
          encryptionConfiguration: {
            encryptionOption: 'SSE_S3'
          }
        },
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
        bytesScannedCutoffPerQuery: 1073741824 // 1GB
      }
    });

    // よく使うクエリの登録
    const queries = [
      {
        name: 'error_logs',
        description: 'エラーログの取得',
        query: `
          SELECT timestamp, level, message, method, url, response_time
          FROM express_logs
          WHERE level = 'error'
          ORDER BY timestamp DESC
          LIMIT 100;
        `
      },
      {
        name: 'slow_responses',
        description: 'レスポンスタイムの分析',
        query: `
          SELECT 
            method,
            url,
            COUNT(*) as count,
            AVG(response_time) as avg_response,
            MAX(response_time) as max_response
          FROM express_logs
          GROUP BY method, url
          HAVING AVG(response_time) > 1000
          ORDER BY avg_response DESC;
        `
      }
    ];

    // 保存クエリの作成
    queries.forEach((q, index) => {
      new athena.CfnNamedQuery(this, `SavedQuery${index}`, {
        database: logsDatabase.ref,
        workGroup: workgroup.ref,
        name: q.name,
        description: q.description,
        queryString: q.query
      });
    });

    // 必要なIAM権限の設定
    const athenaRole = new iam.Role(this, 'AthenaQueryRole', {
      assumedBy: new iam.ServicePrincipal('athena.amazonaws.com')
    });

    athenaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        existingLogBucket.bucketArn,
        `${existingLogBucket.bucketArn}/*`,
        queryResultsBucket.bucketArn,
        `${queryResultsBucket.bucketArn}/*`
      ],
      actions: [
        's3:GetBucketLocation',
        's3:GetObject',
        's3:ListBucket',
        's3:PutObject'
      ]
    }));

    // CloudFormationの出力
    new cdk.CfnOutput(this, 'AthenaWorkgroupName', {
      value: workgroup.name,
      description: 'Athenaワークグループ名'
    });

    new cdk.CfnOutput(this, 'GlueDatabaseName', {
      value: logsDatabase.ref,
      description: 'Glueデータベース名'
    });

    new cdk.CfnOutput(this, 'QueryResultsBucketName', {
      value: queryResultsBucket.bucketName,
      description: 'Athenaクエリ結果バケット名'
    });
  }
}