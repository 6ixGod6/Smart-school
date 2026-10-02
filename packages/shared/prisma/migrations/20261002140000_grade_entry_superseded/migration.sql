-- A published correction must retire every lower version of the same assessment.
-- Supersession lives on the row so parent reads cannot forget to hide the old score.

ALTER TABLE "grade_entries" ADD COLUMN "superseded_at" TIMESTAMPTZ;
ALTER TABLE "grade_entries" ADD COLUMN "superseded_by_grade_id" UUID;

CREATE UNIQUE INDEX "grade_entries_school_id_id_key"
  ON "grade_entries"("school_id", "id");

ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_superseded_by_grade_id_fkey"
  FOREIGN KEY ("superseded_by_grade_id") REFERENCES "grade_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_superseded_by_tenant_fkey"
  FOREIGN KEY ("school_id", "superseded_by_grade_id")
  REFERENCES "grade_entries"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_superseded_pair"
  CHECK (("superseded_at" IS NULL) = ("superseded_by_grade_id" IS NULL));

CREATE INDEX "grade_entries_superseded_by_grade_id_idx"
  ON "grade_entries"("superseded_by_grade_id");
