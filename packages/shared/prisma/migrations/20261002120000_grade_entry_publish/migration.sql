-- Publish timestamp and a sequence so two quizzes can coexist in one period.
-- Versioned unique key so a published correction is a new row, not an overwrite.

ALTER TABLE "grade_entries" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "grade_entries" ADD COLUMN "published_at" TIMESTAMPTZ;

ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_sequence_positive"
  CHECK ("sequence" >= 1);

CREATE UNIQUE INDEX "grade_entries_student_id_subject_id_period_id_assessment_type_sequence_version_key"
  ON "grade_entries"("student_id", "subject_id", "period_id", "assessment_type", "sequence", "version");
