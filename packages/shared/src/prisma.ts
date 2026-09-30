import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/prisma/client.ts";

export function createPrisma(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export { PrismaClient, Prisma };
export type { PrismaClient as PrismaClientType } from "./generated/prisma/client.ts";
