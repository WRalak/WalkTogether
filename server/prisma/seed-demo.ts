import { prisma } from '../src/database/prisma';
import { hashPassword } from '../src/shared/password';
import { createClub } from '../src/modules/clubs/clubs.service';
import { createUserWithDefaults } from '../src/modules/auth/auth.service';

/** Local-development demo data. The password is printed so developers can sign in. */
export async function seedDemo() {
  // nosemgrep: node_password -- local demo data; seed.ts refuses to run in staging/production
  const password = 'walktogether-demo-1';
  const passwordHash = await hashPassword(password);
  const users = [
    { email: 'owner@demo.walktogether.local', username: 'demo_owner', displayName: 'Wanjiku (Demo Owner)' },
    { email: 'member@demo.walktogether.local', username: 'demo_member', displayName: 'Otieno (Demo Member)' },
  ];
  const ids: string[] = [];
  for (const u of users) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    const user = existing ?? (await prisma.$transaction((tx) => createUserWithDefaults(tx, { ...u, passwordHash, emailVerified: true })));
    ids.push(user.id);
  }
  if (!(await prisma.club.findUnique({ where: { slug: 'nairobi-sunrise-walkers' } }))) {
    await createClub(
      ids[0]!,
      {
        name: 'Nairobi Sunrise Walkers',
        slug: 'nairobi-sunrise-walkers',
        description: 'Early-morning community walks around Karura Forest and the Arboretum. All paces welcome.',
        category: 'WALKING',
        visibility: 'PUBLIC',
        city: 'Nairobi',
        countryCode: 'KE',
        latitude: -1.2341,
        longitude: 36.8327,
      },
      {},
    );
  }
  console.log(`Demo users: ${users.map((u) => u.email).join(', ')} / password: ${password}`);
}
