const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function main() {
  // Delete all existing records in reverse order of dependencies
  console.log('Deleting existing records...');
  await prisma.$executeRaw`TRUNCATE TABLE "Notification" RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE "MicropostView" RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE "Comment" RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE "Like" RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE "CategoryMicropost" RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE "Category" RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE "Micropost" RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE "Follow" RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE "UserRole" RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE "UserProfile" RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE "User" RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE "Role" RESTART IDENTITY CASCADE`;
  console.log('All existing records have been deleted');

  // Create roles
  const roles = [
    { name: 'user', description: 'Regular user role' },
    { name: 'admin', description: 'Administrator role' },
    { name: 'read-only-admin', description: 'Read-only administrator role' }
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: role
    });
  }

  console.log('Default roles have been created');

  // Get role IDs
  const userRole = await prisma.role.findUnique({ where: { name: 'user' } });
  const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });

  // Create default user
  const defaultUser = await prisma.user.upsert({
    where: { email: 'user@example.com' },
    update: {},
    create: {
      email: 'user@example.com',
      password: await hashPassword('password'),
      name: 'DefaultUser',
      profile: {
        create: {
          bio: 'I am a default user',
          location: 'Japan',
          website: 'https://example.com'
        }
      },
      userRoles: {
        create: {
          roleId: userRole.id
        }
      }
    }
  });

  // Create default admin
  const defaultAdmin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      password: await hashPassword('password'),
      name: 'SystemAdmin',
      profile: {
        create: {
          bio: 'I am the system administrator',
          location: 'Japan',
          website: 'https://example.com'
        }
      },
      userRoles: {
        create: {
          roleId: adminRole.id
        }
      }
    }
  });

  console.log('Default users have been created');

  // Create sample users with microposts
  const sampleUsers = [
    {
      email: 'tanaka@example.com',
      password: await hashPassword('password'),
      name: 'TanakaTaro',
      profile: {
        bio: '趣味は読書とプログラミングです',
        location: '東京',
        website: 'https://tanaka-blog.example.com'
      },
      microposts: [
        { 
          title: '今日は素晴らしい天気ですね！',
          categories: ['日常']
        },
        { 
          title: '新しいプロジェクトを始めました。頑張ります！',
          categories: ['仕事', '技術']
        }
      ]
    },
    {
      email: 'yamada@example.com',
      password: await hashPassword('password'),
      name: 'YamadaHanako',
      profile: {
        bio: 'デザイナーをしています',
        location: '大阪',
        website: 'https://yamada-design.example.com'
      },
      microposts: [
        { 
          title: 'デザインの新しいトレンドについて考えています',
          categories: ['仕事', '技術']
        },
        { 
          title: '今日のランチは美味しかった！🍜',
          categories: ['日常']
        }
      ]
    },
    {
      email: 'suzuki@example.com',
      password: await hashPassword('password'),
      name: 'SuzukiIchiro',
      profile: {
        bio: 'エンジニア歴5年目です',
        location: '福岡',
        website: 'https://suzuki-tech.example.com'
      },
      microposts: [
        { 
          title: '新しい技術スタックの学習を始めました',
          categories: ['技術', '学習']
        },
        { 
          title: 'チーム開発の醍醐味を実感する日々です',
          categories: ['仕事', '技術']
        }
      ]
    }
  ];

  // Create categories first
  const categories = [
    { name: '技術' },
    { name: '日常' },
    { name: '趣味' },
    { name: '仕事' },
    { name: '学習' },
    { name: 'イベント' }
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: {},
      create: category
    });
  }

  console.log('Categories have been created');

  // Create users and their microposts with categories
  for (const userData of sampleUsers) {
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {},
      create: {
        email: userData.email,
        password: userData.password,
        name: userData.name,
        profile: {
          create: userData.profile
        },
        userRoles: {
          create: {
            roleId: userRole.id
          }
        }
      }
    });

    // Create microposts with categories
    for (const postData of userData.microposts) {
      const micropost = await prisma.micropost.create({
        data: {
          title: postData.title,
          userId: user.id
        }
      });

      // Add categories to micropost
      for (const categoryName of postData.categories) {
        const category = await prisma.category.findUnique({
          where: { name: categoryName }
        });
        
        await prisma.categoryMicropost.create({
          data: {
            micropostId: micropost.id,
            categoryId: category.id
          }
        });
      }
    }
    
    console.log(`Created/Updated sample user: ${user.name}`);
  }

  console.log('Sample users and microposts have been created/updated');

  // Create follow relationships
  const allUsers = await prisma.user.findMany();
  
  // Create some follow relationships
  const followRelationships = [
    { follower: 'tanaka@example.com', following: 'yamada@example.com' },
    { follower: 'tanaka@example.com', following: 'suzuki@example.com' },
    { follower: 'yamada@example.com', following: 'tanaka@example.com' },
    { follower: 'suzuki@example.com', following: 'tanaka@example.com' },
    { follower: 'suzuki@example.com', following: 'yamada@example.com' },
    { follower: 'user@example.com', following: 'tanaka@example.com' },
    { follower: 'user@example.com', following: 'yamada@example.com' }
  ];

  for (const relationship of followRelationships) {
    const follower = allUsers.find(user => user.email === relationship.follower);
    const following = allUsers.find(user => user.email === relationship.following);
    
    if (follower && following) {
      await prisma.follow.create({
        data: {
          followerId: follower.id,
          followingId: following.id
        }
      });
      console.log(`Created follow relationship: ${follower.name} -> ${following.name}`);
    }
  }

  console.log('Follow relationships have been created');

  // Create sample comments
  const comments = [
    { content: 'とても興味深い投稿ですね！', authorEmail: 'yamada@example.com', targetEmail: 'tanaka@example.com' },
    { content: '私も同じように感じています', authorEmail: 'suzuki@example.com', targetEmail: 'yamada@example.com' },
    { content: 'とても参考になりました！', authorEmail: 'tanaka@example.com', targetEmail: 'suzuki@example.com' }
  ];

  for (const comment of comments) {
    const author = await prisma.user.findUnique({ where: { email: comment.authorEmail } });
    const targetUser = await prisma.user.findUnique({ where: { email: comment.targetEmail } });
    const targetPost = await prisma.micropost.findFirst({ where: { userId: targetUser.id } });

    const createdComment = await prisma.comment.create({
      data: {
        content: comment.content,
        userId: author.id,
        micropostId: targetPost.id
      }
    });

    // Create notification for comment
    await prisma.notification.create({
      data: {
        type: 'COMMENT',
        recipientId: targetUser.id,
        actorId: author.id,
        micropostId: targetPost.id,
        commentId: createdComment.id
      }
    });
  }

  console.log('Comments and their notifications have been created');

  // Create sample micropost views
  const sampleIPs = ['192.168.1.1', '192.168.1.2', '192.168.1.3'];
  const allMicroposts = await prisma.micropost.findMany();

  for (const micropost of allMicroposts) {
    for (const ip of sampleIPs) {
      await prisma.micropostView.create({
        data: {
          micropostId: micropost.id,
          ipAddress: ip
        }
      });
    }
  }

  console.log('Micropost views have been created');

  // Create sample likes and their notifications
  const likes = [
    { likerEmail: 'yamada@example.com', targetEmail: 'tanaka@example.com' },
    { likerEmail: 'suzuki@example.com', targetEmail: 'yamada@example.com' },
    { likerEmail: 'tanaka@example.com', targetEmail: 'suzuki@example.com' }
  ];

  for (const like of likes) {
    const liker = await prisma.user.findUnique({ where: { email: like.likerEmail } });
    const targetUser = await prisma.user.findUnique({ where: { email: like.targetEmail } });
    const targetPost = await prisma.micropost.findFirst({ where: { userId: targetUser.id } });

    await prisma.like.create({
      data: {
        userId: liker.id,
        micropostId: targetPost.id
      }
    });

    // Create notification for like
    await prisma.notification.create({
      data: {
        type: 'LIKE',
        recipientId: targetUser.id,
        actorId: liker.id,
        micropostId: targetPost.id
      }
    });
  }

  console.log('Likes and their notifications have been created');

  // Create follow notifications
  for (const relationship of followRelationships) {
    const follower = await prisma.user.findUnique({ where: { email: relationship.follower } });
    const following = await prisma.user.findUnique({ where: { email: relationship.following } });

    await prisma.notification.create({
      data: {
        type: 'FOLLOW',
        recipientId: following.id,
        actorId: follower.id
      }
    });
  }

  console.log('Follow notifications have been created');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 