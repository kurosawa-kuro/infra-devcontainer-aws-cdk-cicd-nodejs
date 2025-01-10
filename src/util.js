const http = require('http');

async function checkInstanceType() {
    // EC2のメタデータエンドポイントをチェック
    try {
        const metadata = await new Promise((resolve, reject) => {
            const req = http.get('http://169.254.169.254/latest/meta-data/instance-id', {
                timeout: 1000
            }, (res) => {
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

        // EC2のメタデータが取得できた場合
        console.log('Running on EC2:', metadata);
        return 'EC2';

    } catch (error) {
        // Lightsailの場合はメタデータエンドポイントにアクセスできない
        console.log('Running on Lightsail or other environment');
        return 'Lightsail/Other';
    }
}

