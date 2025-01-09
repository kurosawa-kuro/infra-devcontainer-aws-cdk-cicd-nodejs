const { PrismaClient } = require('@prisma/client');
const { PATHS } = require('../../src/constants');
const prisma = new PrismaClient();

async function main() {
  // すべてのプロフィールを取得
  const profiles = await prisma.userProfile.findMany();

  // 各プロフィールのアバターパスを修正
  for (const profile of profiles) {
    let newPath;
    if (!profile.avatarPath) {
      newPath = PATHS.DEFAULT_AVATAR;
    } else if (profile.avatarPath.startsWith('/uploads/')) {
      newPath = profile.avatarPath;
    } else {
      newPath = `/uploads/${profile.avatarPath.replace(/^\//, '')}`;
    }

    if (newPath !== profile.avatarPath) {
      await prisma.userProfile.update({
        where: { id: profile.id },
        data: { avatarPath: newPath }
      });
      console.log(`Updated avatar path for profile ${profile.id}: ${profile.avatarPath} -> ${newPath}`);
    }
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 