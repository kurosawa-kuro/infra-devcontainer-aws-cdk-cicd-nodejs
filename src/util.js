const http = require('http');
const fs = require('fs');
const path = require('path');
const { logger } = require('./middleware/core/logging');

class Util {
    /**
     * Check the instance type of the current environment
     * @returns {Promise<string>} Returns 'EC2' or 'Lightsail/Other'
     */
    static async checkInstanceType() {
        // インスタンス名が lightsail-dev-app の場合は Lightsail として扱う
        const instanceName = process.env.INSTANCE_NAME || 'lightsail-dev-app';
        if (instanceName === 'lightsail-dev-app') {
            logger.info('Running on Lightsail (detected via instance name)');
            return 'Lightsail/Other';
        }

        try {
            const metadata = await new Promise((resolve, reject) => {
                const req = http.get('http://169.254.169.254/latest/meta-data/tags/instance/aws:lightsail:instancename', {
                    timeout: 1000
                }, (res) => {
                    if (res.statusCode === 404) {
                        reject(new Error('Not a Lightsail instance'));
                        return;
                    }
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve(data));
                });
                
                req.on('error', reject);
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Timeout'));
                });
            });

            if (metadata) {
                logger.info('Running on Lightsail (detected via metadata)');
                return 'Lightsail/Other';
            }
        } catch (error) {
            // デフォルトでLightsailとして扱う
            logger.warn('Assuming Lightsail environment:', error.message);
            return 'Lightsail/Other';
        }

        return 'Lightsail/Other';
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
}

module.exports = { Util };

