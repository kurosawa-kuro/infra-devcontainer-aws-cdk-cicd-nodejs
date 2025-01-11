const { 
    SecretsManagerClient,
    GetSecretValueCommand
  } = require('@aws-sdk/client-secrets-manager');
  const fs = require('fs/promises');
  const path = require('path');
  
  const SECRET_NAME = 'javascript-app-credentials';
  const REGION = 'ap-northeast-1';
  
  /**
   * Get credentials from AWS Secrets Manager
   */
  async function getAwsSecrets() {
      const client = new SecretsManagerClient({ region: REGION });
      
      try {
          const response = await client.send(
              new GetSecretValueCommand({
                  SecretId: SECRET_NAME,
                  VersionStage: 'AWSCURRENT'
              })
          );
          
          const secrets = JSON.parse(response.SecretString);
          return {
              AWS_ACCESS_KEY_ID: secrets.AWS_ACCESS_KEY_ID,
              AWS_SECRET_ACCESS_KEY: secrets.AWS_SECRET_ACCESS_KEY,
              SLACK_WEBHOOK_URL: secrets.SLACK_WEBHOOK_URL
          };
      } catch (error) {
          console.error('Error fetching secrets:', error);
          throw new Error('Failed to fetch secrets from AWS Secrets Manager');
      }
  }
  
  /**
   * Update specific environment variables in .env file
   */
  async function updateEnvFile(secrets) {
      try {
          // Read the current .env file
          const envPath = path.resolve(process.cwd(), '.env');
          const currentEnv = await fs.readFile(envPath, 'utf8');
          
          // Update only specific variables
          const updatedEnv = currentEnv
              .replace(/^_AWS_ACCESS_KEY_ID=.*/m, `_AWS_ACCESS_KEY_ID=${secrets.AWS_ACCESS_KEY_ID}`)
              .replace(/^_AWS_SECRET_ACCESS_KEY=.*/m, `_AWS_SECRET_ACCESS_KEY=${secrets.AWS_SECRET_ACCESS_KEY}`)
              .replace(/^_SLACK_WEBHOOK_URL=.*/m, `_SLACK_WEBHOOK_URL=${secrets.SLACK_WEBHOOK_URL}`)
              .replace(/^AWS_ACCESS_KEY_ID=.*/m, `AWS_ACCESS_KEY_ID=${secrets.AWS_ACCESS_KEY_ID}`)
              .replace(/^AWS_SECRET_ACCESS_KEY=.*/m, `AWS_SECRET_ACCESS_KEY=${secrets.AWS_SECRET_ACCESS_KEY}`)
              .replace(/^SLACK_WEBHOOK_URL=.*/m, `SLACK_WEBHOOK_URL=${secrets.SLACK_WEBHOOK_URL}`);
          
          await fs.writeFile(envPath, updatedEnv, 'utf8');
          console.log('Successfully updated specific variables in .env file!');
      } catch (error) {
          console.error('Error updating .env file:', error);
          throw new Error('Failed to update .env file');
      }
  }
  
  /**
   * Main function to setup environment
   */
  async function main() {
      try {
          console.log('Fetching secrets from AWS Secrets Manager...');
          const secrets = await getAwsSecrets();
          
          console.log('Updating specific variables in .env file...');
          await updateEnvFile(secrets);
      } catch (error) {
          console.error('Setup failed:', error.message);
          process.exit(1);
      }
  }
  
  // Execute the script
  if (require.main === module) {
      main();
  }
  
  module.exports = {
      getAwsSecrets,
      updateEnvFile
  };