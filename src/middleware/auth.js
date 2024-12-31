const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  
  // Check if this is an API request or test request
  const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
  
  if (isApiRequest) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  
  res.redirect('/auth/login');
};

const forwardAuthenticated = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
};

const hasRole = (roleName) => {
  return (req, res, next) => {
    if (!req.isAuthenticated()) {
      const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
      if (isApiRequest) {
        return res.status(401).json({ message: 'Authentication required' });
      }
      return res.redirect('/auth/login');
    }

    const hasRequiredRole = req.user.userRoles.some(userRole => userRole.role.name === roleName);
    if (!hasRequiredRole) {
      const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
      if (isApiRequest) {
        return res.status(403).json({ message: 'Insufficient permissions' });
      }
      req.flash('error', '権限が不足しています');
      return res.redirect('/');
    }

    next();
  };
};

const hasAnyRole = (roleNames) => {
  return (req, res, next) => {
    if (!req.isAuthenticated()) {
      const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
      if (isApiRequest) {
        return res.status(401).json({ message: 'Authentication required' });
      }
      return res.redirect('/auth/login');
    }

    const hasRequiredRole = req.user.userRoles.some(userRole => 
      roleNames.includes(userRole.role.name)
    );
    
    if (!hasRequiredRole) {
      const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
      if (isApiRequest) {
        return res.status(403).json({ message: 'Insufficient permissions' });
      }
      req.flash('error', '権限が不足しています');
      return res.redirect('/');
    }

    next();
  };
};

const isAdmin = hasRole('admin');

const canManageUser = (req, res, next) => {
  if (!req.isAuthenticated()) {
    const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
    if (isApiRequest) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    return res.redirect('/auth/login');
  }

  const targetUserId = parseInt(req.params.id, 10);
  const isOwnProfile = req.user.id === targetUserId;
  const isAdmin = req.user.userRoles.some(userRole => userRole.role.name === 'admin');

  if (!isOwnProfile && !isAdmin) {
    const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
    if (isApiRequest) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    req.flash('error', '権限が不足しています');
    return res.redirect('/');
  }

  next();
};

module.exports = {
  isAuthenticated,
  forwardAuthenticated,
  hasRole,
  hasAnyRole,
  isAdmin,
  canManageUser
}; 