import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class AwsErrorNotificationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // スクリプトパスを修正
    const notificationScriptPath = path.join(__dirname, '../../../script/aws_service/lambda/send_notification.js');

    // スクリプトの存在確認
    if (!fs.existsSync(notificationScriptPath)) {
      console.error(`Notification script not found at: ${notificationScriptPath}`);
      process.exit(1);
    }

    // スクリプト実行用の環境変数を設定
    const envVars = {
      ...process.env,
      MESSAGE: 'CDK Deployment Notification',
      ERROR: 'Sample error message',
    };

    try {
      // Node.jsスクリプトを同期的に実行（引数を追加）
      const result = child_process.execSync(
        `node ${notificationScriptPath} "${envVars.MESSAGE}" --error "${envVars.ERROR}"`,
        {
          encoding: 'utf-8',
          env: envVars,
        }
      );

      console.log('Notification script executed successfully:', result);
    } catch (error) {
      // 型安全なエラーメッセージの取得
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Failed to execute notification script:', errorMessage);
      throw new Error(`Notification script execution failed: ${errorMessage}`);
    }
  }
}
