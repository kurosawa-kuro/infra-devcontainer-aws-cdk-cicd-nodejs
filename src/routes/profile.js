const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { isAuthenticated, canManageUser } = require('../middleware/auth');

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed!'));
  }
});

// Show profile
router.get('/:id', isAuthenticated, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        profile: true,
        userRoles: {
          include: {
            role: true
          }
        }
      }
    });

    if (!user) {
      const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
      if (isApiRequest) {
        return res.status(404).json({ message: 'User not found' });
      }
      req.flash('error', 'ユーザーが見つかりません');
      return res.redirect('/');
    }

    res.render('profile/show', {
      user,
      userProfile: user.profile,
      roles: user.userRoles.map(ur => ur.role.name)
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
    if (isApiRequest) {
      return res.status(500).json({ message: 'Error fetching profile' });
    }
    req.flash('error', 'プロフィールの取得中にエラーが発生しました');
    res.redirect('/');
  }
});

// Show edit form
router.get('/:id/edit', canManageUser, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        profile: true,
        userRoles: {
          include: {
            role: true
          }
        }
      }
    });

    if (!user) {
      const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
      if (isApiRequest) {
        return res.status(404).json({ message: 'User not found' });
      }
      req.flash('error', 'ユーザーが見つかりません');
      return res.redirect('/');
    }

    res.render('profile/edit', {
      user,
      userProfile: user.profile,
      roles: user.userRoles.map(ur => ur.role.name)
    });
  } catch (error) {
    console.error('Error fetching profile for edit:', error);
    const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
    if (isApiRequest) {
      return res.status(500).json({ message: 'Error fetching profile' });
    }
    req.flash('error', 'プロフィールの取得中にエラーが発生しました');
    res.redirect('/');
  }
});

// Update profile
router.put('/:id', canManageUser, upload.single('avatar'), async (req, res) => {
  try {
    const updateData = {
      bio: req.body.bio,
      location: req.body.location,
      website: req.body.website,
      birthDate: req.body.birthDate ? new Date(req.body.birthDate) : null
    };

    if (req.file) {
      updateData.avatarPath = req.file.path;
    }

    const userProfile = await prisma.userProfile.upsert({
      where: {
        userId: parseInt(req.params.id)
      },
      update: updateData,
      create: {
        userId: parseInt(req.params.id),
        ...updateData
      }
    });

    const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
    if (isApiRequest) {
      return res.status(200).json({ message: 'Profile updated successfully', profile: userProfile });
    }

    req.flash('success', 'プロフィールを更新しました');
    res.redirect(`/profile/${req.params.id}`);
  } catch (error) {
    console.error('Error updating profile:', error);
    const isApiRequest = req.xhr || req.headers.accept?.includes('json') || process.env.NODE_ENV === 'test';
    if (isApiRequest) {
      return res.status(500).json({ message: 'Error updating profile' });
    }
    req.flash('error', 'プロフィールの更新中にエラーが発生しました');
    res.redirect(`/profile/${req.params.id}/edit`);
  }
});

module.exports = router; 