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
  await prisma.micropost.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.userProfile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
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
          title: '今日は素晴らしい天気ですね！'
        },
        { 
          title: '新しいプロジェクトを始めました。頑張ります！'
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
          title: 'デザインの新しいトレンドについて考えています'
        },
        { 
          title: '今日のランチは美味しかった！🍜'
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
          title: '新しい技術スタックの学習を始めました'
        },
        { 
          title: 'チーム開発の醍醐味を実感する日々です'
        }
      ]
    }
  ];

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
        },
        microposts: {
          create: userData.microposts
        }
      }
    });
    console.log(`Created/Updated sample user: ${user.name}`);
  }

  console.log('Sample users and microposts have been created/updated');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 