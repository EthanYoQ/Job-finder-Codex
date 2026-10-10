import { PrismaClient } from "@prisma/client";
import { runPrivacyRetention } from "../src/server/privacyRetention";

const prisma = new PrismaClient();
try {
  const result = await runPrivacyRetention(prisma);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await prisma.$disconnect();
}
