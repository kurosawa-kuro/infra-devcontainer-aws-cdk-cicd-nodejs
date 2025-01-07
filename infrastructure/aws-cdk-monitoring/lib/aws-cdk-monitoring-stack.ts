import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

interface AwsCdkMonitoringStackProps extends cdk.StackProps {
  instanceId?: string;
  imageId?: string;
  instanceType?: string;
  environment?: string;
}

export class AwsCdkMonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: AwsCdkMonitoringStackProps) {
    super(scope, id, props);

    const prefix = props?.environment || 'prod';

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

    // EC2インスタンスの共通ディメンション
    const commonDimensions = {
      InstanceId: props?.instanceId || '',
      ImageId: props?.imageId || '',
      InstanceType: props?.instanceType || '',
    };

    // CPU使用率アラーム
    const cpuMetric = new cloudwatch.Metric({
      namespace: 'AWS/EC2',
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

    // HDD使用率アラーム
    const diskMetric = new cloudwatch.Metric({
      namespace: 'CWAgent',
      metricName: 'disk_used_percent',
      dimensionsMap: {
        ...commonDimensions,
        path: '/',
        filesystem: '/dev/xvda1',
      },
      ...commonMetricProps,
    });

    const diskAlarm = new cloudwatch.Alarm(this, 'DiskUsageAlarm', {
      metric: diskMetric,
      alarmDescription: 'HDD使用率が80%を超過',
      alarmName: `${prefix}-DiskUsageAlarm`,
      ...commonAlarmProps,
    });
    diskAlarm.addAlarmAction(new actions.SnsAction(alertTopic));

    // メモリ使用率アラーム
    const memoryMetric = new cloudwatch.Metric({
      namespace: 'CWAgent',
      metricName: 'mem_used_percent',
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

    // ダッシュボード作成
    const dashboard = new cloudwatch.Dashboard(this, 'MonitoringDashboard');
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'System Resources',
        left: [cpuMetric, memoryMetric],
        right: [diskMetric, swapMetric],
        width: 24,
        height: 6,
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      })
    );
  }
}