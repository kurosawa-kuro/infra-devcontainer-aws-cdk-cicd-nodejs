const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/auth/login');
};

const forwardAuthenticated = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
};

const isAdmin = (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.flash('error', 'ログインが必要です');
    return res.redirect('/auth/login');
  }

  const isAdmin = req.user.userRoles?.some(ur => ur.role.name === 'admin');
  if (!isAdmin) {
    req.flash('error', '管理者権限が必要です');
    return res.redirect('/');
  }

  next();
};

const canManageUser = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/auth/login');
  }

  const isOwnProfile = req.user.id === parseInt(req.params.id, 10);
  const isAdmin = req.user.userRoles.some(ur => ur.role.name === 'admin');

  if (isOwnProfile || isAdmin) {
    return next();
  }

  // APIリクエストの場合は403を返す
  const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
  if (isApiRequest) {
    return res.status(403).json({ 
      error: 'Forbidden',
      message: '他のユーザーのプロフィールは編集できません'
    });
  }

  // 通常のリクエストの場合はエラーページを表示
  req.flash('error', '他のユーザーのプロフィールは編集できません');
  res.redirect('/');
};

const handle404Error = (req, res, next) => {
  const isApiRequest = req.xhr || req.headers.accept?.includes('application/json');
  if (isApiRequest) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'リクエストされたページは存在しません'
    });
  }
  res.status(404).render('pages/errors/404', {
    title: 'ページが見つかりません',
    path: req.path
  });
};

const handle500Error = (err, req, res, next) => {
  console.error('Server Error:', err);

  const isApiRequest = req.xhr || req.headers.accept?.includes('application/json');
  if (isApiRequest) {
    return res.status(500).json({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' 
        ? 'サーバーエラーが発生しました'
        : err.message
    });
  }

  res.status(500).render('pages/errors/500', {
    title: 'サーバーエラー',
    path: req.path,
    error: process.env.NODE_ENV === 'production' ? null : err
  });
};

module.exports = {
  isAuthenticated,
  forwardAuthenticated,
  isAdmin,
  canManageUser,
  handle404Error,
  handle500Error
}; 