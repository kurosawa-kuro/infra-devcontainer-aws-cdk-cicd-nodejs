const passport = require('passport');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const { logger } = require('../core/logging');
const { setupSecurity } = require('../core/security');


class InitializationMiddleware {
  /**
   * アプリケーションの初期化を行う
   * @param {Express.Application} app Expressアプリケーション
   * @param {Object} options 初期化オプション
   * @param {Object} options.routes ルート設定
   * @param {Object} options.controllers コントローラー
   * @param {Object} options.fileUploader ファイルアップローダー
   * @param {Object} options.passportService Passportサービス
   * @param {Object} options.util ユーティリティ
   */
  static async initialize(app, { routes, controllers, fileUploader, passportService, util }) {
    try {

      // 1. AWS設定の確認 2. インスタンスタイプの検出と環境設定はtestの場合はスキップ
      if (process.env.NODE_ENV !== 'test') {
        // 1. AWS設定の確認
        const awsConfig = await util.checkAwsConfiguration();

        // 2. インスタンスタイプの検出と環境設定
        this.configureStorageType(awsConfig.instanceType);
      }

      // 3. 必要なディレクトリの作成
      await util.setupDirectories();

      // 4. 基本的なミドルウェアのセットアップ
      await this.setupCore(app, passportService);
   
      // 5. ルートの設定
      routes(app, controllers, fileUploader);   
    } catch (error) {
      logger.error('Failed to initialize application:', error);
      throw error;
    }
  }

  /**
   * コアミドルウェアのセットアップ
   */
  static async setupCore(app, passportService) {
    logger.info('Starting core middleware setup');

    try {
      // 1. 基本的なミドルウェアのセットアップ
      // Body parser
      app.use(express.json());
      app.use(express.urlencoded({ extended: true }));

      // Static files
      app.use(express.static(path.join(__dirname, '../../public')));

      // View engine
      app.set('view engine', 'ejs');
      app.set('views', path.join(__dirname, '../..', 'views'));

      // Layout
      app.use(expressLayouts);
      app.set('layout', 'layouts/public');
      app.set("layout extractScripts", true);
      app.set("layout extractStyles", true);
      logger.info('Basic middleware setup completed');

      // 2. セキュリティ関連のセットアップ
      setupSecurity(app);
      logger.info('Security middleware setup completed');

      // 3. Passportの設定
      passportService.configurePassport();
      app.use(passport.initialize());
      app.use(passport.session());
      logger.info('Passport authentication setup completed');

    } catch (error) {
      logger.error('Failed to setup core middleware:', error);
      throw error;
    }
  }

  /**
   * インスタンスタイプの検出
   */
  static async detectInstanceType(util) {
    try {
      logger.info(`Starting application on ${process.env.INSTANCE_TYPE || 'Lightsail/Other'}`);
      return process.env.INSTANCE_TYPE || 'Lightsail/Other';
    } catch (error) {
      logger.warn('Failed to determine instance type, defaulting to Lightsail/Other:', error);
      return 'Lightsail/Other';
    }
  }

  /**
   * ストレージタイプの設定
   */
  static configureStorageType(instanceType) {
    if (instanceType === 'Lightsail/Other') {
      logger.info('Running on Lightsail - using local storage configuration');
      process.env.USE_S3 = 'false';
    } else {
      logger.info('Running on EC2 - using S3 storage configuration');
      process.env.USE_S3 = 'true';
    }
  }
}

module.exports = InitializationMiddleware; 