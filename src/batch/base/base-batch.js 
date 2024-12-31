const cron = require('node-cron');
const winston = require('winston');
const path = require('path');

class BaseBatch {
  constructor(batchName) {
    this.batchName = batchName;
    this.logger = this.setupLogger();
  }

  setupLogger() {
    return winston.createLogger({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        new winston.transports.File({
          filename: path.join(__dirname, '../../../logs/batch.log')
        })
      ]
    });
  }

  async execute() {
    throw new Error('execute method must be implemented by child class');
  }

  async executeNow() {
    this.logger.info(`Starting immediate execution of ${this.batchName}`);
    try {
      await this.execute();
      this.logger.info(`Completed immediate execution of ${this.batchName}`);
    } catch (error) {
      this.logger.error(`Error executing ${this.batchName}: ${error.message}`);
      throw error;
    }
  }

  startScheduler(cronExpression = '0 0 * * *') {
    if (process.argv.includes('--now')) {
      this.executeNow()
        .then(() => process.exit(0))
        .catch(error => {
          this.logger.error(`Failed to execute ${this.batchName}:`, error);
          process.exit(1);
        });
      return;
    }

    cron.schedule(cronExpression, async () => {
      this.logger.info(`Starting scheduled execution of ${this.batchName}`);
      try {
        await this.execute();
        this.logger.info(`Completed scheduled execution of ${this.batchName}`);
      } catch (error) {
        this.logger.error(`Error in scheduled execution of ${this.batchName}: ${error.message}`);
      }
    });

    process.on('SIGINT', async () => {
      this.logger.info(`Received SIGINT. Performing final execution of ${this.batchName}...`);
      await this.execute();
      process.exit(0);
    });

    this.logger.info(`${this.batchName} scheduler started`);
  }
}

module.exports = BaseBatch; 