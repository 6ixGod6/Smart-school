import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrisma, type PrismaClient } from "@smart-school/shared";
import { loadConfig } from "../config.ts";

describe("schema tenancy indexes", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const config = loadConfig(process.env);
    prisma = createPrisma(config.databaseUrl);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("puts school_id on every tenant table and indexes it", async () => {
    const tablesWithColumn = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attname = 'school_id'
        AND NOT a.attisdropped
      ORDER BY c.relname
    `;
    const indexed = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT DISTINCT tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexdef ILIKE '%school_id%'
    `;
    const indexedSet = new Set(indexed.map((row) => row.tablename));
    const missing = tablesWithColumn.map((row) => row.table_name).filter((name) => !indexedSet.has(name));
    expect(missing, `tables with school_id but no index: ${missing.join(", ")}`).toEqual([]);
    expect(tablesWithColumn.length).toBeGreaterThan(10);
  });
});
