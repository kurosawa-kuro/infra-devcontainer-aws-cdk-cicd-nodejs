const { logger } = require('../logging');
const { setupBasic, setupAuthMiddleware, setupSession } = require('../');
const { setupSecurity } = require('../security');

class SetupMiddleware {
  static async setupApplication(app, routes, controllers, fileUploader) {
    console.log('\n=== Middleware Setup Start ===');
    
    // 1. Basic middleware setup
    setupBasic(app);
    console.log('1. Basic middleware setup complete');

    // 2. Session setup
    setupSession(app);
    console.log('2. Session setup complete');

    // 3. Security middleware
    setupSecurity(app);
    console.log('3. Security middleware setup complete');

    // 4. Routes setup
    console.log('4. Setting up routes with controllers');
    routes(app, controllers, fileUploader);
    console.log('=== Routes Setup Complete ===\n');
  }

  static async setupDirectories(fileUploader) {
    logger.info('Setting up required directories');
    await fileUploader.setupDirectories();
  }
}

module.exports = SetupMiddleware; 