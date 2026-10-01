-- Tenant-consistency composite foreign keys.
-- Prisma can attach school_id to only one relation per model; this migration
-- also adds the remaining (school_id, parent_id) FKs so a cross-tenant row
-- is rejected by PostgreSQL, not just by application code.

-- Unique (school_id, id) targets for composite FKs.
CREATE UNIQUE INDEX "staff_users_school_id_id_key" ON "staff_users"("school_id", "id");
CREATE UNIQUE INDEX "parents_school_id_id_key" ON "parents"("school_id", "id");
CREATE UNIQUE INDEX "grade_levels_school_id_id_key" ON "grade_levels"("school_id", "id");
CREATE UNIQUE INDEX "sections_school_id_id_key" ON "sections"("school_id", "id");
CREATE UNIQUE INDEX "students_school_id_id_key" ON "students"("school_id", "id");
CREATE UNIQUE INDEX "subjects_school_id_id_key" ON "subjects"("school_id", "id");
CREATE UNIQUE INDEX "subject_assignments_school_id_id_key" ON "subject_assignments"("school_id", "id");
CREATE UNIQUE INDEX "periods_school_id_id_key" ON "periods"("school_id", "id");
CREATE UNIQUE INDEX "grade_groups_school_id_id_key" ON "grade_groups"("school_id", "id");
CREATE UNIQUE INDEX "audiences_school_id_id_key" ON "audiences"("school_id", "id");
CREATE UNIQUE INDEX "charge_batches_school_id_id_key" ON "charge_batches"("school_id", "id");
CREATE UNIQUE INDEX "fee_charge_items_school_id_id_key" ON "fee_charge_items"("school_id", "id");
CREATE UNIQUE INDEX "events_school_id_id_key" ON "events"("school_id", "id");
CREATE UNIQUE INDEX "payments_school_id_id_key" ON "payments"("school_id", "id");
CREATE UNIQUE INDEX "notifications_school_id_id_key" ON "notifications"("school_id", "id");
CREATE UNIQUE INDEX "push_subscriptions_school_id_id_key" ON "push_subscriptions"("school_id", "id");
CREATE UNIQUE INDEX "receipts_school_id_payment_id_key" ON "receipts"("school_id", "payment_id");

-- Sections: school_id must match the grade level's school.
ALTER TABLE "sections" DROP CONSTRAINT "sections_school_id_fkey";
ALTER TABLE "sections" DROP CONSTRAINT "sections_grade_level_id_fkey";
ALTER TABLE "sections" ADD CONSTRAINT "sections_grade_level_tenant_fkey"
  FOREIGN KEY ("school_id", "grade_level_id") REFERENCES "grade_levels"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Students: school_id must match the section's school.
ALTER TABLE "students" DROP CONSTRAINT "students_school_id_fkey";
ALTER TABLE "students" DROP CONSTRAINT "students_section_id_fkey";
ALTER TABLE "students" ADD CONSTRAINT "students_section_tenant_fkey"
  FOREIGN KEY ("school_id", "section_id") REFERENCES "sections"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Parent–student links.
ALTER TABLE "parent_student_links" DROP CONSTRAINT "parent_student_links_parent_id_fkey";
ALTER TABLE "parent_student_links" DROP CONSTRAINT "parent_student_links_student_id_fkey";
ALTER TABLE "parent_student_links" DROP CONSTRAINT "parent_student_links_school_id_fkey";
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_parent_tenant_fkey"
  FOREIGN KEY ("school_id", "parent_id") REFERENCES "parents"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_student_tenant_fkey"
  FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grade-level subjects.
ALTER TABLE "grade_level_subjects" DROP CONSTRAINT "grade_level_subjects_school_id_fkey";
ALTER TABLE "grade_level_subjects" DROP CONSTRAINT "grade_level_subjects_grade_level_id_fkey";
ALTER TABLE "grade_level_subjects" DROP CONSTRAINT "grade_level_subjects_subject_id_fkey";
ALTER TABLE "grade_level_subjects" ADD CONSTRAINT "grade_level_subjects_grade_level_tenant_fkey"
  FOREIGN KEY ("school_id", "grade_level_id") REFERENCES "grade_levels"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grade_level_subjects" ADD CONSTRAINT "grade_level_subjects_subject_tenant_fkey"
  FOREIGN KEY ("school_id", "subject_id") REFERENCES "subjects"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Teacher assignments.
ALTER TABLE "subject_assignments" DROP CONSTRAINT "subject_assignments_school_id_fkey";
ALTER TABLE "subject_assignments" DROP CONSTRAINT "subject_assignments_section_id_fkey";
ALTER TABLE "subject_assignments" ADD CONSTRAINT "subject_assignments_section_tenant_fkey"
  FOREIGN KEY ("school_id", "section_id") REFERENCES "sections"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subject_assignments" DROP CONSTRAINT "subject_assignments_teacher_id_fkey";
ALTER TABLE "subject_assignments" ADD CONSTRAINT "subject_assignments_teacher_tenant_fkey"
  FOREIGN KEY ("school_id", "teacher_id") REFERENCES "staff_users"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subject_assignments" DROP CONSTRAINT "subject_assignments_subject_id_fkey";
ALTER TABLE "subject_assignments" ADD CONSTRAINT "subject_assignments_subject_tenant_fkey"
  FOREIGN KEY ("school_id", "subject_id") REFERENCES "subjects"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Attendance: student must belong to the same school. recorded_by stays a
-- simple staff FK so a platform super_admin (school_id NULL) can still be stored.
ALTER TABLE "attendance_records" DROP CONSTRAINT "attendance_records_school_id_fkey";
ALTER TABLE "attendance_records" DROP CONSTRAINT "attendance_records_student_id_fkey";
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_tenant_fkey"
  FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grade entries.
ALTER TABLE "grade_entries" DROP CONSTRAINT "grade_entries_school_id_fkey";
ALTER TABLE "grade_entries" DROP CONSTRAINT "grade_entries_student_id_fkey";
ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_student_tenant_fkey"
  FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grade_entries" DROP CONSTRAINT "grade_entries_subject_id_fkey";
ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_subject_tenant_fkey"
  FOREIGN KEY ("school_id", "subject_id") REFERENCES "subjects"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grade_entries" DROP CONSTRAINT "grade_entries_period_id_fkey";
ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_period_tenant_fkey"
  FOREIGN KEY ("school_id", "period_id") REFERENCES "periods"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grade groups.
ALTER TABLE "grade_group_grade_levels" DROP CONSTRAINT "grade_group_grade_levels_grade_group_id_fkey";
ALTER TABLE "grade_group_grade_levels" DROP CONSTRAINT "grade_group_grade_levels_grade_level_id_fkey";
ALTER TABLE "grade_group_grade_levels" DROP CONSTRAINT "grade_group_grade_levels_school_id_fkey";
ALTER TABLE "grade_group_grade_levels" ADD CONSTRAINT "grade_group_grade_levels_group_tenant_fkey"
  FOREIGN KEY ("school_id", "grade_group_id") REFERENCES "grade_groups"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grade_group_grade_levels" ADD CONSTRAINT "grade_group_grade_levels_level_tenant_fkey"
  FOREIGN KEY ("school_id", "grade_level_id") REFERENCES "grade_levels"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audience snapshot.
ALTER TABLE "audience_snapshot_members" DROP CONSTRAINT "audience_snapshot_members_audience_id_fkey";
ALTER TABLE "audience_snapshot_members" DROP CONSTRAINT "audience_snapshot_members_student_id_fkey";
ALTER TABLE "audience_snapshot_members" DROP CONSTRAINT "audience_snapshot_members_school_id_fkey";
ALTER TABLE "audience_snapshot_members" ADD CONSTRAINT "audience_snapshot_members_audience_tenant_fkey"
  FOREIGN KEY ("school_id", "audience_id") REFERENCES "audiences"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audience_snapshot_members" ADD CONSTRAINT "audience_snapshot_members_student_tenant_fkey"
  FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Charge batches.
ALTER TABLE "charge_batches" DROP CONSTRAINT "charge_batches_school_id_fkey";
ALTER TABLE "charge_batches" DROP CONSTRAINT "charge_batches_audience_id_fkey";
ALTER TABLE "charge_batches" ADD CONSTRAINT "charge_batches_audience_tenant_fkey"
  FOREIGN KEY ("school_id", "audience_id") REFERENCES "audiences"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "charge_batches" DROP CONSTRAINT "charge_batches_created_by_staff_id_fkey";
ALTER TABLE "charge_batches" ADD CONSTRAINT "charge_batches_creator_tenant_fkey"
  FOREIGN KEY ("school_id", "created_by_staff_id") REFERENCES "staff_users"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "charge_batches" DROP CONSTRAINT "charge_batches_source_event_id_fkey";
ALTER TABLE "charge_batches" ADD CONSTRAINT "charge_batches_event_tenant_fkey"
  FOREIGN KEY ("school_id", "source_event_id") REFERENCES "events"("school_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fee charge items.
ALTER TABLE "fee_charge_items" DROP CONSTRAINT "fee_charge_items_school_id_fkey";
ALTER TABLE "fee_charge_items" DROP CONSTRAINT "fee_charge_items_student_id_fkey";
ALTER TABLE "fee_charge_items" ADD CONSTRAINT "fee_charge_items_student_tenant_fkey"
  FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_charge_items" DROP CONSTRAINT "fee_charge_items_charge_batch_id_fkey";
ALTER TABLE "fee_charge_items" ADD CONSTRAINT "fee_charge_items_batch_tenant_fkey"
  FOREIGN KEY ("school_id", "charge_batch_id") REFERENCES "charge_batches"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_charge_items" DROP CONSTRAINT "fee_charge_items_source_event_id_fkey";
ALTER TABLE "fee_charge_items" ADD CONSTRAINT "fee_charge_items_event_tenant_fkey"
  FOREIGN KEY ("school_id", "source_event_id") REFERENCES "events"("school_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Events.
ALTER TABLE "events" DROP CONSTRAINT "events_school_id_fkey";
ALTER TABLE "events" DROP CONSTRAINT "events_audience_id_fkey";
ALTER TABLE "events" ADD CONSTRAINT "events_audience_tenant_fkey"
  FOREIGN KEY ("school_id", "audience_id") REFERENCES "audiences"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "events" DROP CONSTRAINT "events_created_by_staff_id_fkey";
ALTER TABLE "events" ADD CONSTRAINT "events_creator_tenant_fkey"
  FOREIGN KEY ("school_id", "created_by_staff_id") REFERENCES "staff_users"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Event participation.
ALTER TABLE "event_participations" DROP CONSTRAINT "event_participations_event_id_fkey";
ALTER TABLE "event_participations" DROP CONSTRAINT "event_participations_student_id_fkey";
ALTER TABLE "event_participations" DROP CONSTRAINT "event_participations_school_id_fkey";
ALTER TABLE "event_participations" DROP CONSTRAINT "event_participations_confirmed_by_parent_id_fkey";
ALTER TABLE "event_participations" ADD CONSTRAINT "event_participations_event_tenant_fkey"
  FOREIGN KEY ("school_id", "event_id") REFERENCES "events"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_participations" ADD CONSTRAINT "event_participations_student_tenant_fkey"
  FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_participations" ADD CONSTRAINT "event_participations_parent_tenant_fkey"
  FOREIGN KEY ("school_id", "confirmed_by_parent_id") REFERENCES "parents"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Payments.
ALTER TABLE "payments" DROP CONSTRAINT "payments_school_id_fkey";
ALTER TABLE "payments" DROP CONSTRAINT "payments_parent_id_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_parent_tenant_fkey"
  FOREIGN KEY ("school_id", "parent_id") REFERENCES "parents"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Payment line items.
ALTER TABLE "payment_charge_items" DROP CONSTRAINT "payment_charge_items_payment_id_fkey";
ALTER TABLE "payment_charge_items" DROP CONSTRAINT "payment_charge_items_charge_item_id_fkey";
ALTER TABLE "payment_charge_items" DROP CONSTRAINT "payment_charge_items_school_id_fkey";
ALTER TABLE "payment_charge_items" ADD CONSTRAINT "payment_charge_items_payment_tenant_fkey"
  FOREIGN KEY ("school_id", "payment_id") REFERENCES "payments"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_charge_items" ADD CONSTRAINT "payment_charge_items_charge_tenant_fkey"
  FOREIGN KEY ("school_id", "charge_item_id") REFERENCES "fee_charge_items"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Receipts.
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_school_id_fkey";
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_payment_id_fkey";
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_tenant_fkey"
  FOREIGN KEY ("school_id", "payment_id") REFERENCES "payments"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Notifications.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_school_id_fkey";
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_parent_id_fkey";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_parent_tenant_fkey"
  FOREIGN KEY ("school_id", "parent_id") REFERENCES "parents"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_student_id_fkey";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_student_tenant_fkey"
  FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Push subscriptions.
ALTER TABLE "push_subscriptions" DROP CONSTRAINT "push_subscriptions_school_id_fkey";
ALTER TABLE "push_subscriptions" DROP CONSTRAINT "push_subscriptions_parent_id_fkey";
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_parent_tenant_fkey"
  FOREIGN KEY ("school_id", "parent_id") REFERENCES "parents"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
