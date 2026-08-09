import { PrismaClient } from "@prisma/client";
import { encryptionExtension } from "./prisma-encryption";

// Single Prisma instance across hot reloads in dev. The client is extended with
// transparent field-level encryption for sensitive columns (see
// prisma-encryption.ts) so plaintext never reaches the database.
function makeClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  }).$extends(encryptionExtension);
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof makeClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
