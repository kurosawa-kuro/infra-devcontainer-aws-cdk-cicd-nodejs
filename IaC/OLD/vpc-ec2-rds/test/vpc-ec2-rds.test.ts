import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as VpcEc2Rds from '../lib/vpc-ec2-rds-stack';

describe('VpcEc2RdsStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new VpcEc2Rds.VpcEc2RdsStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  // VPCのテスト
  test('VPC should be created with correct CIDR', () => {
    template.hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '10.0.0.0/16',
      EnableDnsHostnames: true,
      EnableDnsSupport: true,
      Tags: [
        {
          Key: 'Name',
          Value: 'training-01-vpc'
        }
      ]
    });
  });

  // サブネットのテスト
  test('Should create public and private subnets', () => {
    template.resourceCountIs('AWS::EC2::Subnet', 4); // 2 public + 2 private subnets
    
    // パブリックサブネットの検証
    template.hasResourceProperties('AWS::EC2::Subnet', {
      MapPublicIpOnLaunch: true,
      Tags: [
        {
          Key: 'Name',
          Value: 'training-01-subnet-pub-1a'
        }
      ]
    });
  });

  // セキュリティグループのテスト
  test('Should create security groups with correct rules', () => {
    // Webサーバー用セキュリティグループ
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupName: 'training-01-sg-web',
      SecurityGroupIngress: [
        {
          CidrIp: '0.0.0.0/0',
          FromPort: 22,
          IpProtocol: 'tcp',
          ToPort: 22,
          Description: 'Allow SSH'
        },
        {
          CidrIp: '0.0.0.0/0',
          FromPort: 80,
          IpProtocol: 'tcp',
          ToPort: 80,
          Description: 'Allow HTTP'
        },
        {
          CidrIp: '0.0.0.0/0',
          FromPort: 3001,
          IpProtocol: 'tcp',
          ToPort: 3001,
          Description: 'Allow PM2'
        }
      ]
    });
  });

  // EC2インスタンスのテスト
  test('Should create EC2 instance with correct configuration', () => {
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't2.micro',
      ImageId: {
        'Fn::Ref': expect.any(String)
      }
    });
  });

  // RDSインスタンスのテスト
  test('Should create RDS instance with correct configuration', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      DBInstanceClass: 'db.t3.micro',
      MultiAZ: true,
      PubliclyAccessible: false,
      AllocatedStorage: 20,
      MaxAllocatedStorage: 20
    });
  });

  // ALBのテスト
  test('Should create ALB with correct configuration', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      Type: 'application',
      LoadBalancerAttributes: [
        {
          Key: 'deletion_protection.enabled',
          Value: 'false'
        }
      ]
    });

    // ターゲットグループの検証
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Protocol: 'HTTP',
      Port: 80,
      HealthCheckPath: '/api/health'
    });
  });
});
