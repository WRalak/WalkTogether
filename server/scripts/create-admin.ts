/**
 * Bootstrap a platform administrator. There is deliberately no HTTP endpoint for this.
 *
 *   npm run admin:create -w @walktogether/server -- --email you@example.com --name "Your Name" [--role SUPER_ADMIN]
 *
 * The password is read from the ADMIN_PASSWORD environment variable or prompted for (not echoed).
 * MFA enrolment is forced at first sign-in.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { passwordSchema, emailSchema } from '@walktogether/validation';
import { SYSTEM_ADMIN_ROLES } from '@walktogether/shared-types';
import { prisma } from '../src/database/prisma';
import { hashPassword } from '../src/shared/password';
import { syncPermissionCatalog } from '../src/modules/platform/catalog';
import { audit } from '../src/modules/audit/audit.service';

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function readPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  // Mute echo while typing.
  const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => (s.includes('Password') ? write.call(rl, s) : undefined);
  const pw = await rl.question('Password: ');
  rl.close();
  stdout.write('\n');
  return pw;
}

async function main() {
  const email = emailSchema.parse(arg('email'));
  const displayName = arg('name') ?? email;
  const roleKey = (arg('role') ?? 'SUPER_ADMIN') as (typeof SYSTEM_ADMIN_ROLES)[number];
  if (!SYSTEM_ADMIN_ROLES.includes(roleKey)) throw new Error(`Role must be one of ${SYSTEM_ADMIN_ROLES.join(', ')}`);
  const password = passwordSchema.parse(await readPassword());
  if (password.length < 14) throw new Error('Administrator passwords must be at least 14 characters');

  await syncPermissionCatalog();
  const role = await prisma.adminRole.findUniqueOrThrow({ where: { key: roleKey } });
  const admin = await prisma.adminUser.create({ data: { email, displayName, passwordHash: await hashPassword(password), roleId: role.id } });
  await audit({ actorType: 'SYSTEM', action: 'admin.created', targetType: 'admin', targetId: admin.id, metadata: { role: roleKey, via: 'cli' } });
  console.log(`Created ${roleKey} ${email}. MFA enrolment will be required at first sign-in.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    const { redis } = await import('../src/database/redis');
    redis.disconnect();
  });
