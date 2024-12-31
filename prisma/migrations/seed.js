const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function main() {
  // Create default roles
  const roles = [
    {
      name: 'user',
      description: 'Default user role with basic permissions'
    },
    {
      name: 'admin',
      description: 'Administrator role with full permissions'
    }
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: {
        name: role.name,
        description: role.description
      }
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
      name: 'Default User',
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
      name: 'System Admin',
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 