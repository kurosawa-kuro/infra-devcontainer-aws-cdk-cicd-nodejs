const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 