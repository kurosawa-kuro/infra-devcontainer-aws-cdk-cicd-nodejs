const http = require('http');
const fs = require('fs');
const path = require('path');
const { logger } = require('./middleware/core/logging');
const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { CloudFrontClient, GetDistributionCommand } = require('@aws-sdk/client-cloudfront');

class Util {
    /**
     * Checks AWS related configurations and credentials
     * @returns {Promise<Object>} Returns configuration status
     * @throws {Error} If any AWS related checks fail
     */
    static async checkAwsConfiguration() {
        try {
            // インスタンスタイプの確認
            const instanceType = await this._checkInstanceType();
            
            // 認証情報の確認
            const hasValidCredentials = await this._checkAwsCredentials();

            // S3バケットとCloudFrontの確認
            const storageStatus = await this._checkStorageConfiguration();
            
            return {
                instanceType,
                hasValidCredentials,
                isAwsEnabled: process.env.USE_AWS === 'true',
                ...storageStatus
            };
        } catch (error) {
            logger.error('AWS設定の検証に失敗しました', { error });
            throw error;
        }
    }

    /**
     * Internal: Check if the current environment is running on Lightsail
     * @private
     * @returns {Promise<string>} Returns 'EC2' or 'Lightsail/Other'
     */
    static async _checkInstanceType() {
        const USE_LIGHTSAIL = process.env.USE_LIGHTSAIL === 'true';
        
        if (USE_LIGHTSAIL) {
            logger.info('Running on Lightsail environment');
            return 'Lightsail/Other';
        }

        logger.info('Running on EC2 environment');
        return 'EC2';
    }

    /**
     * Internal: Check AWS credentials are properly set when USE_AWS is true
     * @private
     * @returns {Promise<boolean>} Returns true if credentials are properly set
     * @throws {Error} If credentials are not properly set when USE_AWS is true
     */
    static async _checkAwsCredentials() {
        const useAws = process.env.USE_AWS === 'true';
        
        if (!useAws) {
            logger.info('AWS integration is disabled');
            return true;
        }

        const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

        // 基本的な環境変数チェック
        if (!accessKeyId || !secretAccessKey || accessKeyId.trim() === '' || secretAccessKey.trim() === '') {
            const error = new Error('AWS認証情報が環境変数に正しく設定されていません');
            logger.error('AWS credential check failed', { error });
            throw error;
        }

        // aws configure listによる実際の認証情報の検証
        try {
            const { exec } = require('child_process');
            const awsCheck = new Promise((resolve, reject) => {
                exec('aws configure list', (error, stdout, stderr) => {
                    if (error) {
                        reject(new Error(`AWS CLIコマンドの実行に失敗しました: ${error.message}`));
                        return;
                    }
                    if (stderr) {
                        reject(new Error(`AWS CLIエラー: ${stderr}`));
                        return;
                    }
                    
                    // 出力行を解析
                    const lines = stdout.split('\n');
                    const accessKeyLine = lines.find(line => line.includes('access_key'));
                    const secretKeyLine = lines.find(line => line.includes('secret_key'));
                    
                    // アクセスキーとシークレットキーの行が存在し、値が設定されているか確認
                    const hasAccessKey = accessKeyLine && 
                                      !accessKeyLine.includes('<not set>') && 
                                      accessKeyLine.includes('****************');
                    const hasSecretKey = secretKeyLine && 
                                      !secretKeyLine.includes('<not set>') && 
                                      secretKeyLine.includes('****************');
                    
                    if (!hasAccessKey || !hasSecretKey) {
                        reject(new Error('AWS CLIに認証情報が設定されていません'));
                        return;
                    }
                    
                    resolve(true);
                });
            });

            await awsCheck;
            logger.info('AWS認証情報が正しく設定されています');
            return true;
        } catch (error) {
            logger.error('AWS認証情報の検証に失敗しました', { error });
            throw error;
        }
    }

    /**
     * アプリケーションに必要なディレクトリを作成・設定
     */
    static async setupDirectories() {
        logger.info('Setting up required directories');
        
        const dirs = [
            path.join(process.cwd(), 'public'),
            path.join(process.cwd(), 'public', 'uploads'),
            path.join(process.cwd(), 'public', 'css'),
            path.join(process.cwd(), 'logs')
        ];

        for (const dir of dirs) {
            try {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                    logger.info(`Created directory: ${dir}`);
                }
                fs.chmodSync(dir, '755');
                logger.info(`Set permissions for directory: ${dir}`);
            } catch (error) {
                logger.error(`Failed to setup directory: ${dir}`, { error });
                throw error;
            }
        }
    }

    /**
     * Internal: Check S3 bucket and CloudFront distribution existence
     * @private
     * @returns {Promise<Object>} Returns storage configuration status
     */
    static async _checkStorageConfiguration() {
        const s3Client = new S3Client({});
        const cloudFrontClient = new CloudFrontClient({});
        const status = {
            s3BucketExists: false,
            cloudFrontExists: false,
            warnings: []
        };

        // S3バケットの確認
        const bucketName = process.env.STORAGE_S3_BUCKET;
        if (bucketName) {
            try {
                await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
                status.s3BucketExists = true;
                logger.info(`S3バケット ${bucketName} が存在することを確認しました`);
            } catch (error) {
                status.warnings.push(`S3バケット ${bucketName} が存在しないか、アクセスできません`);
                logger.warn(`S3バケットの確認に失敗しました: ${error.message}`);
            }
        }

        // CloudFrontの確認
        const distributionId = process.env.STORAGE_CDN_DISTRIBUTION_ID;
        const cdnUrl = process.env.STORAGE_CDN_URL;
        if (distributionId && cdnUrl) {
            try {
                await cloudFrontClient.send(new GetDistributionCommand({ Id: distributionId }));
                status.cloudFrontExists = true;
                logger.info(`CloudFront Distribution ${distributionId} が存在することを確認しました`);
            } catch (error) {
                status.warnings.push(`CloudFront Distribution ${distributionId} が存在しないか、アクセスできません`);
                logger.warn(`CloudFrontの確認に失敗しました: ${error.message}`);
            }
        }

        return status;
    }
}

module.exports = { Util };

