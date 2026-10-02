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

  it("keeps every Prisma-invisible tenant and academic-year constraint", async () => {
    const constraints = await prisma.$queryRaw<Array<{ name: string; kind: string }>>`
      SELECT c.conname AS name,
        CASE c.contype
          WHEN 'f' THEN 'foreign_key'
          WHEN 'c' THEN 'check'
          WHEN 'x' THEN 'exclusion'
          WHEN 'u' THEN 'unique'
          ELSE c.contype::text
        END AS kind
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public'
    `;
    const indexes = await prisma.$queryRaw<Array<{ name: string; def: string }>>`
      SELECT indexname AS name, indexdef AS def
      FROM pg_indexes
      WHERE schemaname = 'public'
    `;
    const byName = new Map(constraints.map((row) => [row.name, row.kind]));
    const indexByName = new Map(indexes.map((row) => [row.name, row.def]));

    const missing: string[] = [];
    const wrongKind: string[] = [];
    for (const expected of PRISMA_INVISIBLE_CONSTRAINTS) {
      if (expected.kind === "partial_unique_index") {
        const def = indexByName.get(expected.name);
        if (!def) {
          missing.push(expected.name);
          continue;
        }
        if (!/UNIQUE/i.test(def) || !/WHERE/i.test(def)) {
          wrongKind.push(`${expected.name} (wanted partial unique index, got ${def})`);
        }
        continue;
      }
      const kind = byName.get(expected.name);
      if (!kind) {
        missing.push(expected.name);
        continue;
      }
      if (kind !== expected.kind) {
        wrongKind.push(`${expected.name} (wanted ${expected.kind}, got ${kind})`);
      }
    }

    expect(missing, `missing Prisma-invisible constraints: ${missing.join(", ")}`).toEqual([]);
    expect(wrongKind, `wrong constraint type: ${wrongKind.join("; ")}`).toEqual([]);
  });
});

/**
 * Raw-SQL constraints Prisma cannot express (or only expresses on one relation).
 * `prisma migrate dev` will offer to DROP these as drift. If you add a new one
 * in a hand-written migration, add it here too.
 */
export const PRISMA_INVISIBLE_CONSTRAINTS: Array<{
  name: string;
  kind: "foreign_key" | "check" | "exclusion" | "partial_unique_index";
}> = [
  { name: "sections_grade_level_tenant_fkey", kind: "foreign_key" },
  { name: "parent_student_links_parent_tenant_fkey", kind: "foreign_key" },
  { name: "parent_student_links_student_tenant_fkey", kind: "foreign_key" },
  { name: "grade_level_subjects_grade_level_tenant_fkey", kind: "foreign_key" },
  { name: "grade_level_subjects_subject_tenant_fkey", kind: "foreign_key" },
  { name: "subject_assignments_section_tenant_fkey", kind: "foreign_key" },
  { name: "subject_assignments_teacher_tenant_fkey", kind: "foreign_key" },
  { name: "subject_assignments_subject_tenant_fkey", kind: "foreign_key" },
  { name: "subject_assignments_year_tenant_fkey", kind: "foreign_key" },
  { name: "attendance_records_student_tenant_fkey", kind: "foreign_key" },
  { name: "grade_entries_student_tenant_fkey", kind: "foreign_key" },
  { name: "grade_entries_subject_tenant_fkey", kind: "foreign_key" },
  { name: "grade_entries_period_tenant_fkey", kind: "foreign_key" },
  { name: "grade_group_grade_levels_group_tenant_fkey", kind: "foreign_key" },
  { name: "grade_group_grade_levels_level_tenant_fkey", kind: "foreign_key" },
  { name: "audience_snapshot_members_audience_tenant_fkey", kind: "foreign_key" },
  { name: "audience_snapshot_members_student_tenant_fkey", kind: "foreign_key" },
  { name: "charge_batches_audience_tenant_fkey", kind: "foreign_key" },
  { name: "charge_batches_creator_tenant_fkey", kind: "foreign_key" },
  { name: "charge_batches_event_tenant_fkey", kind: "foreign_key" },
  { name: "charge_batches_year_tenant_fkey", kind: "foreign_key" },
  { name: "fee_charge_items_student_tenant_fkey", kind: "foreign_key" },
  { name: "fee_charge_items_batch_tenant_fkey", kind: "foreign_key" },
  { name: "fee_charge_items_event_tenant_fkey", kind: "foreign_key" },
  { name: "events_audience_tenant_fkey", kind: "foreign_key" },
  { name: "events_creator_tenant_fkey", kind: "foreign_key" },
  { name: "event_participations_event_tenant_fkey", kind: "foreign_key" },
  { name: "event_participations_student_tenant_fkey", kind: "foreign_key" },
  { name: "event_participations_parent_tenant_fkey", kind: "foreign_key" },
  { name: "payments_parent_tenant_fkey", kind: "foreign_key" },
  { name: "payment_charge_items_payment_tenant_fkey", kind: "foreign_key" },
  { name: "payment_charge_items_charge_tenant_fkey", kind: "foreign_key" },
  { name: "receipts_payment_tenant_fkey", kind: "foreign_key" },
  { name: "notifications_parent_tenant_fkey", kind: "foreign_key" },
  { name: "notifications_student_tenant_fkey", kind: "foreign_key" },
  { name: "push_subscriptions_parent_tenant_fkey", kind: "foreign_key" },
  { name: "periods_year_tenant_fkey", kind: "foreign_key" },
  { name: "enrollments_year_tenant_fkey", kind: "foreign_key" },
  { name: "enrollments_student_tenant_fkey", kind: "foreign_key" },
  { name: "enrollments_section_tenant_fkey", kind: "foreign_key" },
  { name: "academic_years_one_active_per_school", kind: "partial_unique_index" },
  { name: "academic_years_dates_no_overlap", kind: "exclusion" },
  { name: "periods_dates_no_overlap", kind: "exclusion" },
  { name: "periods_summer_no_grade_tally", kind: "check" },
  { name: "periods_summer_no_semester", kind: "check" },
  { name: "academic_years_date_order", kind: "check" },
  { name: "grade_entries_sequence_positive", kind: "check" },
];
