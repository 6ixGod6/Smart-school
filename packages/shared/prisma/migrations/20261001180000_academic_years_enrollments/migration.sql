-- Academic years, enrollments, year-scoped periods/assignments/charges.
-- Backfill: one ACTIVE "2026/2027" year per school, one PENDING enrollment
-- per current student.section_id, existing periods and assignments attached.

CREATE TYPE "AcademicYearStatus" AS ENUM ('PLANNED', 'ACTIVE', 'CLOSED');
CREATE TYPE "PeriodType" AS ENUM ('REGULAR', 'SUMMER');
CREATE TYPE "EnrollmentOutcome" AS ENUM ('PENDING', 'PROMOTED', 'REPEATING', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED');

CREATE TABLE "academic_years" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "AcademicYearStatus" NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "academic_years_school_id_label_key" ON "academic_years"("school_id", "label");
CREATE UNIQUE INDEX "academic_years_school_id_id_key" ON "academic_years"("school_id", "id");
CREATE INDEX "academic_years_school_id_idx" ON "academic_years"("school_id");
CREATE INDEX "academic_years_school_id_status_idx" ON "academic_years"("school_id", "status");

ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one ACTIVE year per school.
CREATE UNIQUE INDEX "academic_years_one_active_per_school"
  ON "academic_years"("school_id")
  WHERE "status" = 'ACTIVE';

-- Years at one school must not overlap (inclusive dates).
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_date_order"
  CHECK ("start_date" <= "end_date");
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_dates_no_overlap"
  EXCLUDE USING gist (
    "school_id" WITH =,
    daterange("start_date", "end_date", '[]') WITH &&
  );

INSERT INTO "academic_years" ("id", "school_id", "label", "start_date", "end_date", "status", "created_at")
SELECT
  gen_random_uuid(),
  s."id",
  '2026/2027',
  COALESCE((SELECT MIN(p."start_date") FROM "periods" p WHERE p."school_id" = s."id"), DATE '2026-08-01'),
  COALESCE((SELECT MAX(p."end_date") FROM "periods" p WHERE p."school_id" = s."id"), DATE '2027-07-31'),
  'ACTIVE',
  NOW()
FROM "schools" s;

-- Periods: year, type, nullable semester, per-period attendance tally flag.
ALTER TABLE "periods" ADD COLUMN "academic_year_id" UUID;
ALTER TABLE "periods" ADD COLUMN "type" "PeriodType" NOT NULL DEFAULT 'REGULAR';
ALTER TABLE "periods" ADD COLUMN "attendance_counts_toward_grade" BOOLEAN;
ALTER TABLE "periods" ALTER COLUMN "semester" DROP NOT NULL;

UPDATE "periods" p
SET "academic_year_id" = y."id"
FROM "academic_years" y
WHERE y."school_id" = p."school_id" AND y."label" = '2026/2027';

ALTER TABLE "periods" ALTER COLUMN "academic_year_id" SET NOT NULL;

ALTER TABLE "periods" DROP CONSTRAINT IF EXISTS "periods_school_id_fkey";
ALTER TABLE "periods" DROP CONSTRAINT IF EXISTS "periods_school_id_number_key";
DROP INDEX IF EXISTS "periods_school_id_number_key";

CREATE UNIQUE INDEX "periods_school_id_academic_year_id_type_number_key"
  ON "periods"("school_id", "academic_year_id", "type", "number");
CREATE INDEX "periods_academic_year_id_idx" ON "periods"("academic_year_id");

ALTER TABLE "periods" ADD CONSTRAINT "periods_year_tenant_fkey"
  FOREIGN KEY ("school_id", "academic_year_id") REFERENCES "academic_years"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "periods" ADD CONSTRAINT "periods_summer_no_grade_tally"
  CHECK ("type" <> 'SUMMER' OR "attendance_counts_toward_grade" = false);
ALTER TABLE "periods" ADD CONSTRAINT "periods_summer_no_semester"
  CHECK (
    ("type" = 'REGULAR' AND "semester" IS NOT NULL) OR
    ("type" = 'SUMMER' AND "semester" IS NULL)
  );
-- School-wide: two periods must never cover the same date (periodCoveringDate uses findFirst).
ALTER TABLE "periods" ADD CONSTRAINT "periods_dates_no_overlap"
  EXCLUDE USING gist (
    "school_id" WITH =,
    daterange("start_date", "end_date", '[]') WITH &&
  );

-- Subject assignments become year-scoped.
ALTER TABLE "subject_assignments" ADD COLUMN "academic_year_id" UUID;

UPDATE "subject_assignments" a
SET "academic_year_id" = y."id"
FROM "academic_years" y
WHERE y."school_id" = a."school_id" AND y."label" = '2026/2027';

ALTER TABLE "subject_assignments" ALTER COLUMN "academic_year_id" SET NOT NULL;

ALTER TABLE "subject_assignments" DROP CONSTRAINT IF EXISTS "subject_assignments_teacher_id_subject_id_section_id_key";
DROP INDEX IF EXISTS "subject_assignments_teacher_id_subject_id_section_id_key";

CREATE UNIQUE INDEX "subject_assignments_teacher_id_subject_id_section_id_academic_year_id_key"
  ON "subject_assignments"("teacher_id", "subject_id", "section_id", "academic_year_id");
CREATE INDEX "subject_assignments_academic_year_id_idx" ON "subject_assignments"("academic_year_id");

ALTER TABLE "subject_assignments" ADD CONSTRAINT "subject_assignments_year_tenant_fkey"
  FOREIGN KEY ("school_id", "academic_year_id") REFERENCES "academic_years"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Charge batches belong to a year (platform fee is once per student per year).
ALTER TABLE "charge_batches" ADD COLUMN "academic_year_id" UUID;

UPDATE "charge_batches" b
SET "academic_year_id" = y."id"
FROM "academic_years" y
WHERE y."school_id" = b."school_id" AND y."label" = '2026/2027';

ALTER TABLE "charge_batches" ALTER COLUMN "academic_year_id" SET NOT NULL;
CREATE INDEX "charge_batches_academic_year_id_idx" ON "charge_batches"("academic_year_id");
ALTER TABLE "charge_batches" ADD CONSTRAINT "charge_batches_year_tenant_fkey"
  FOREIGN KEY ("school_id", "academic_year_id") REFERENCES "academic_years"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "outcome" "EnrollmentOutcome" NOT NULL DEFAULT 'PENDING',
    "enrolled_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome_set_at" TIMESTAMPTZ,
    "outcome_set_by_staff_id" UUID,
    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

INSERT INTO "enrollments" (
  "id", "school_id", "student_id", "academic_year_id", "section_id", "outcome", "enrolled_at"
)
SELECT
  gen_random_uuid(),
  st."school_id",
  st."id",
  y."id",
  st."section_id",
  'PENDING',
  st."enrolled_at"
FROM "students" st
JOIN "academic_years" y ON y."school_id" = st."school_id" AND y."label" = '2026/2027';

CREATE UNIQUE INDEX "enrollments_student_id_academic_year_id_key" ON "enrollments"("student_id", "academic_year_id");
CREATE UNIQUE INDEX "enrollments_school_id_id_key" ON "enrollments"("school_id", "id");
CREATE INDEX "enrollments_school_id_idx" ON "enrollments"("school_id");
CREATE INDEX "enrollments_student_id_idx" ON "enrollments"("student_id");
CREATE INDEX "enrollments_section_id_idx" ON "enrollments"("section_id");
CREATE INDEX "enrollments_academic_year_id_idx" ON "enrollments"("academic_year_id");

ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_year_tenant_fkey"
  FOREIGN KEY ("school_id", "academic_year_id") REFERENCES "academic_years"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_tenant_fkey"
  FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_section_tenant_fkey"
  FOREIGN KEY ("school_id", "section_id") REFERENCES "sections"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_outcome_set_by_staff_id_fkey"
  FOREIGN KEY ("outcome_set_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_section_id_fkey"
  FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Placement now lives on Enrollment, not Student.
ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "students_section_tenant_fkey";
ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "students_section_id_fkey";
DROP INDEX IF EXISTS "students_section_id_idx";
ALTER TABLE "students" DROP COLUMN "section_id";
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
