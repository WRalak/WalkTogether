#!/usr/bin/env node
/**
 * One-command local setup (Windows, macOS, Linux): `npm run setup`
 *
 *   1. creates server/.env, mobile/.env and platform-admin/.env.local from the examples (never
 *      overwrites a file you already have),
 *   2. starts PostgreSQL + PostGIS and Redis with Docker (skipped when they are already reachable),
 *   3. generates the Prisma client and applies the database migrations,
 *   4. loads demo data (two users and a club) unless you pass --no-demo.
 *
 * Safe to run again at any time.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = !process.argv.includes('--no-demo');
const step = (msg) => console.log(`\n▶ ${msg}`);

function run(cmd, args, { optional = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0 && !optional) {
    console.error(`\n✖ "${cmd} ${args.join(' ')}" failed.`);
    process.exit(r.status ?? 1);
  }
  return r.status === 0;
}

const reachable = (port) =>
  new Promise((resolve) => {
    const s = createConnection({ host: '127.0.0.1', port });
    s.setTimeout(1500);
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('timeout', () => (s.destroy(), resolve(false)));
    s.once('error', () => resolve(false));
  });

async function waitFor(port, label, seconds = 60) {
  for (let i = 0; i < seconds; i++) {
    if (await reachable(port)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`✖ ${label} is not reachable on localhost:${port}.`);
  return false;
}

step('Environment files');
for (const [example, target] of [
  ['server/.env.example', 'server/.env'],
  ['mobile/.env.example', 'mobile/.env'],
  ['platform-admin/.env.example', 'platform-admin/.env.local'],
]) {
  if (existsSync(join(root, target))) console.log(`  ${target} already exists — kept`);
  else {
    copyFileSync(join(root, example), join(root, target));
    console.log(`  created ${target}`);
  }
}

step('PostgreSQL and Redis');
if ((await reachable(5432)) && (await reachable(6379))) {
  console.log('  already running on localhost:5432 and localhost:6379');
} else {
  const started = run('docker', ['compose', 'up', '-d', 'postgres', 'redis'], { optional: true });
  if (!started) {
    console.error(
      '\n✖ Could not start the databases with Docker. Install and start Docker Desktop, then run `npm run setup` again.\n' +
        '  (Or run PostgreSQL 16 + PostGIS on port 5432 and Redis 7 on port 6379 yourself — see README.md.)',
    );
    process.exit(1);
  }
  if (!(await waitFor(5432, 'PostgreSQL')) || !(await waitFor(6379, 'Redis'))) process.exit(1);
  // The port opens slightly before PostgreSQL accepts logins.
  await new Promise((r) => setTimeout(r, 3000));
}

step('Database schema');
run('npm', ['run', 'db:generate']);
run('npm', ['exec', '-w', '@walktogether/server', '--', 'prisma', 'migrate', 'deploy']);

if (demo) {
  step('Demo data');
  run('npm', ['exec', '-w', '@walktogether/server', '--', 'tsx', '--env-file=.env', 'prisma/seed.ts', '--demo']);
}

console.log(`
✔ Ready. In VS Code: Terminal → Run Task… → "WalkTogether: start API + worker + admin"
  (or press F5 and pick "API + worker + platform admin" to run with the debugger).

  API              http://localhost:4000/api/docs
  Platform admin   http://localhost:3002   (create an admin: npm run admin:create -w @walktogether/server -- --email you@example.com --name "Your Name")
  Mobile           Run Task… → "WalkTogether: mobile (Expo)"${demo ? '\n\n  Demo sign-in     owner@demo.walktogether.local / walktogether-demo-1' : ''}
`);
