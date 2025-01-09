import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface AwsCdkMonitoringStackProps extends cdk.StackProps {
  // EC2用のプロパティ
  instanceId?: string;
  imageId?: string;
  instanceType?: string;
  // Fargate用のプロパティ
  clusterName?: string;
  serviceName?: string;
  // 共通プロパティ
  environment?: string;
  isEc2?: boolean;
}

type EC2Dimensions = {
  InstanceId: string;
  ImageId: string;
  InstanceType: string;
};

type FargateDimensions = {
  ClusterName: string;
  ServiceName: string;
};

export class AwsCdkMonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: AwsCdkMonitoringStackProps) {
    super(scope, id, props);

    const prefix = props?.environment || 'prod';
    const isEc2 = props?.isEc2 ?? true;

    // IAMロールの作成（EC2またはFargate用）
    if (isEc2) {
      const cloudWatchAgentRole = new iam.Role(this, 'CloudWatchAgentRole', {
        assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        roleName: `${prefix}-CloudWatchAgentRole`,
      });

      cloudWatchAgentRole.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
      );
    } else {
      const taskExecutionRole = new iam.Role(this, 'FargateTaskExecutionRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        roleName: `${prefix}-FargateTaskExecutionRole`,
      });

      taskExecutionRole.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      );
    }

    // SNSトピック作成
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      masterKey: new kms.Key(this, 'TopicKey', {
        enableKeyRotation: true,
      }),
    });

    // 共通のメトリクス設定
    const commonMetricProps = {
      statistic: 'Average' as const,
      period: cdk.Duration.minutes(5),
    };

    // 共通のアラーム設定
    const commonAlarmProps = {
      threshold: 80,
      evaluationPeriods: 3,
      actionsEnabled: true,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    };

    // 共通ディメンションの設定
    const commonDimensions: Record<string, string> = isEc2
      ? {
          InstanceId: props?.instanceId || '',
          ImageId: props?.imageId || '',
          InstanceType: props?.instanceType || '',
        }
      : {
          ClusterName: props?.clusterName || '',
          ServiceName: props?.serviceName || '',
        };

    // CPU使用率アラーム
    const cpuMetric = new cloudwatch.Metric({
      namespace: isEc2 ? 'AWS/EC2' : 'AWS/ECS',
      metricName: 'CPUUtilization',
      dimensionsMap: commonDimensions,
      ...commonMetricProps,
    });

    const cpuAlarm = new cloudwatch.Alarm(this, 'CPUUtilizationAlarm', {
      metric: cpuMetric,
      alarmDescription: 'CPU使用率が80%を超過',
      alarmName: `${prefix}-CPUUtilizationAlarm`,
      ...commonAlarmProps,
    });
    cpuAlarm.addAlarmAction(new actions.SnsAction(alertTopic));

    // メモリ使用率アラーム
    const memoryMetric = new cloudwatch.Metric({
      namespace: isEc2 ? 'CWAgent' : 'AWS/ECS',
      metricName: isEc2 ? 'mem_used_percent' : 'MemoryUtilization',
      dimensionsMap: commonDimensions,
      ...commonMetricProps,
    });

    const memoryAlarm = new cloudwatch.Alarm(this, 'MemoryUsageAlarm', {
      metric: memoryMetric,
      alarmDescription: 'メモリ使用率が80%を超過',
      alarmName: `${prefix}-MemoryUsageAlarm`,
      ...commonAlarmProps,
    });
    memoryAlarm.addAlarmAction(new actions.SnsAction(alertTopic));

    // EC2固有のメトリクス
    if (isEc2) {
      // HDD使用率アラーム
      const diskMetric = new cloudwatch.Metric({
        namespace: 'CWAgent',
        metricName: 'disk_used_percent',
        dimensionsMap: {
          ...commonDimensions,
          path: '/',
          filesystem: '/dev/xvda1',
        } as Record<string, string>,
        ...commonMetricProps,
      });

      const diskAlarm = new cloudwatch.Alarm(this, 'DiskUsageAlarm', {
        metric: diskMetric,
        alarmDescription: 'HDD使用率が80%を超過',
        alarmName: `${prefix}-DiskUsageAlarm`,
        ...commonAlarmProps,
      });
      diskAlarm.addAlarmAction(new actions.SnsAction(alertTopic));

      // SWAP使用率アラーム
      const swapMetric = new cloudwatch.Metric({
        namespace: 'CWAgent',
        metricName: 'swap_used_percent',
        dimensionsMap: commonDimensions,
        ...commonMetricProps,
      });

      const swapAlarm = new cloudwatch.Alarm(this, 'SwapUsageAlarm', {
        metric: swapMetric,
        alarmDescription: 'SWAP使用率が80%を超過',
        alarmName: `${prefix}-SwapUsageAlarm`,
        ...commonAlarmProps,
      });
      swapAlarm.addAlarmAction(new actions.SnsAction(alertTopic));
    }

    // ダッシュボード作成
    const dashboard = new cloudwatch.Dashboard(this, 'MonitoringDashboard');
    const widgets = [
      new cloudwatch.GraphWidget({
        title: isEc2 ? 'EC2 Resources' : 'Fargate Resources',
        left: [cpuMetric],
        right: [memoryMetric],
        width: 24,
        height: 6,
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
    ];

    if (isEc2) {
      widgets.push(
        new cloudwatch.GraphWidget({
          title: 'EC2 Storage',
          left: [
            new cloudwatch.Metric({
              namespace: 'CWAgent',
              metricName: 'disk_used_percent',
              dimensionsMap: {
                ...commonDimensions,
                path: '/',
                filesystem: '/dev/xvda1',
              } as Record<string, string>,
              ...commonMetricProps,
            }),
          ],
          right: [
            new cloudwatch.Metric({
              namespace: 'CWAgent',
              metricName: 'swap_used_percent',
              dimensionsMap: commonDimensions,
              ...commonMetricProps,
            }),
          ],
          width: 24,
          height: 6,
          period: cdk.Duration.minutes(5),
          statistic: 'Average',
        })
      );
    }

    dashboard.addWidgets(...widgets);
  }
}