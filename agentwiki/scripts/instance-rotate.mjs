import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function decodeSeed(value) {
  const seed = Buffer.from(value, 'base64');
  if (seed.length !== 32) {
    throw new Error('AGENTWIKI_DEPLOYMENT_SEED must decode to exactly 32 bytes');
  }
  return seed;
}

function seedHash(pepper, seed) {
  return createHmac('sha256', Buffer.from(pepper, 'utf8'))
    .update('agentwiki-deployment-seed')
    .update('\0')
    .update(seed)
    .digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--confirm-new-deployment') {
    throw new Error('Usage: node scripts/instance-rotate.mjs --confirm-new-deployment');
  }
  const databaseUrl = requiredEnv('DATABASE_URL');
  const pepper = requiredEnv('AGENTWIKI_SERVER_PEPPER');
  const seed = decodeSeed(requiredEnv('AGENTWIKI_DEPLOYMENT_SEED'));
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const nextHash = seedHash(pepper, seed);
    const nextInstanceId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.serverInstanceIdentity.deleteMany({});
      await tx.serverInstanceIdentity.create({
        data: { instanceId: nextInstanceId, deploymentSeedHash: nextHash },
      });
      await tx.securityAuditEvent.create({
        data: {
          action: 'instance.rotate',
          outcome: 'success',
          metadata: { newInstanceId: nextInstanceId },
        },
      });
    });
    console.log(`Rotated server instance identity to ${nextInstanceId}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
