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

module.exports = {
  isAuthenticated,
  forwardAuthenticated,
  canManageUser
}; 