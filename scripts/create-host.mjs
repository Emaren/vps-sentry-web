// /var/www/vps-sentry-web/scripts/create-host.mjs
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function usage() {
  console.log(`
Usage:
  node scripts/create-host.mjs --email <userEmail> --name <name> [--hostname <hostname>] [--slug <slug>]

Notes:
- Uses DATABASE_URL from env.
- Prints the *plaintext* token ONCE. Store it; we only save the hash.
`);
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

async function main() {
  const email = arg("email");
  const name = arg("name");
  const hostname = arg("hostname");
  const slug = arg("slug");

  if (!email || !name) {
    usage();
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user found for email: ${email}`);

  // token format: vs_<64 hex>
  const token = `vs_${crypto.randomBytes(32).toString("hex")}`;
  const tokenHash = sha256(token);
  const prefix = token.slice(0, 11); // e.g. vs_abcdef1234

  const host = await prisma.host.create({
    data: {
      userId: user.id,
      name,
      slug: slug ?? null,
      metaJson: hostname ? JSON.stringify({ hostname }) : null,
      apiKeys: {
        create: {
          tokenHash,
          prefix,
        },
      },
      auditLogs: {
        create: {
          userId: user.id,
          action: "host.create",
          detail: `Host created via script: ${name}`,
          metaJson: JSON.stringify({ hostname, slug }),
        },
      },
    },
    include: { apiKeys: true },
  });

  console.log(JSON.stringify({
    ok: true,
    hostId: host.id,
    name: host.name,
    token,         // SAVE THIS
    prefix,
    note: "Token shown once; only hash is stored in DB.",
  }, null, 2));
}

main()
  .catch((e) => {
    console.error("ERROR:", e?.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
