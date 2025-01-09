/**
 * アプリケーション全体で使用する定数
 */

// ファイルパス関連
const PATHS = {
  DEFAULT_AVATAR: '/uploads/default_avatar.png',
  UPLOAD_DIR: '/uploads',
  PUBLIC_DIR: '/public'
};

// その他の定数をカテゴリごとに追加可能
const LIMITS = {
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  MAX_TITLE_LENGTH: 100,
  MAX_CONTENT_LENGTH: 1000
};

module.exports = {
  PATHS,
  LIMITS
}; 