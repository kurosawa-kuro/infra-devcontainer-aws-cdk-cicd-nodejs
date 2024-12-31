const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.dashboard = async function(req, res) {
    const stats = {
        totalUsers: await prisma.user.count(),
        totalPosts: await prisma.micropost.count()
    };

    res.render('admin/dashboard', {
        title: '管理者ダッシュボード',
        stats
    });
};

exports.manageUser = async function(req, res) {
    const users = await prisma.user.findMany({
        include: {
            profile: true,
            userRoles: {
                include: {
                    role: true
                }
            },
            _count: {
                select: {
                    microposts: true
                }
            }
        },
        orderBy: {
            id: 'desc'
        }
    });

    res.render('admin/manage-user', {
        title: 'ユーザー管理',
        users
    });
}; 