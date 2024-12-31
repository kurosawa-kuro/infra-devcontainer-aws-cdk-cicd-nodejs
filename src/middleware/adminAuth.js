function isAdmin(req, res, next) {
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
}

module.exports = isAdmin; 