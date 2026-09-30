-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'GRADUATED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE');

-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('QUIZ', 'TEST', 'HOMEWORK', 'EXAM');

-- CreateEnum
CREATE TYPE "GradeEntryState" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "Semester" AS ENUM ('FIRST', 'SECOND');

-- CreateEnum
CREATE TYPE "GradeCadence" AS ENUM ('CONTINUOUS', 'END_OF_PERIOD');

-- CreateEnum
CREATE TYPE "PublishTiming" AS ENUM ('IMMEDIATE', 'GRACE_WINDOW');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('TUITION', 'REGISTRATION', 'ADMISSION', 'EXAMINATION', 'UNIFORM', 'BOOKS', 'TRANSPORTATION', 'MEALS', 'BOARDING', 'SPORTS', 'ACTIVITIES', 'GRADUATION', 'PTA', 'ID_CARDS', 'TECHNOLOGY', 'MISC');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PublishState" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('ACTIVITY', 'MEETING', 'HOLIDAY', 'EXAM', 'TRIP', 'OTHER');

-- CreateEnum
CREATE TYPE "FeeMode" AS ENUM ('MANDATORY', 'OPT_IN');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MTN', 'ORANGE', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ACADEMIC', 'ATTENDANCE', 'FINANCIAL', 'SCHOOL');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WEB_PUSH', 'IN_APP', 'SMS');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "schools" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "id_prefix" TEXT NOT NULL,
    "mtn_msisdn" TEXT,
    "orange_msisdn" TEXT,
    "grade_cadence" "GradeCadence" NOT NULL DEFAULT 'END_OF_PERIOD',
    "publish_timing" "PublishTiming" NOT NULL DEFAULT 'IMMEDIATE',
    "publish_grace_hours" INTEGER NOT NULL DEFAULT 0,
    "attendance_visible_to_parents" BOOLEAN NOT NULL DEFAULT true,
    "attendance_counts_toward_grade" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_users" (
    "id" UUID NOT NULL,
    "school_id" UUID,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parents" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "must_change_pin" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "parents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "staff_user_id" UUID,
    "parent_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "school_id" UUID,
    "actor_staff_id" UUID,
    "actor_parent_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_levels" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "grade_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "grade_level_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_code" TEXT NOT NULL,
    "section_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolled_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_student_links" (
    "parent_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "relationship" TEXT NOT NULL,

    CONSTRAINT "parent_student_links_pkey" PRIMARY KEY ("parent_id","student_id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ,
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_level_subjects" (
    "school_id" UUID NOT NULL,
    "grade_level_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,

    CONSTRAINT "grade_level_subjects_pkey" PRIMARY KEY ("grade_level_id","subject_id")
);

-- CreateTable
CREATE TABLE "subject_assignments" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,

    CONSTRAINT "subject_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periods" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "semester" "Semester" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "grade_entry_deadline" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "recorded_by_staff_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_entries" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "assessment_type" "AssessmentType" NOT NULL,
    "score" DECIMAL(6,2) NOT NULL,
    "state" "GradeEntryState" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "under_review" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "grade_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_groups" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "grade_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_group_grade_levels" (
    "grade_group_id" UUID NOT NULL,
    "grade_level_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,

    CONSTRAINT "grade_group_grade_levels_pkey" PRIMARY KEY ("grade_group_id","grade_level_id")
);

-- CreateTable
CREATE TABLE "audiences" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "include" JSONB NOT NULL,
    "exclude" JSONB NOT NULL,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "audiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audience_snapshot_members" (
    "audience_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,

    CONSTRAINT "audience_snapshot_members_pkey" PRIMARY KEY ("audience_id","student_id")
);

-- CreateTable
CREATE TABLE "charge_batches" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ChargeType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "audience_id" UUID NOT NULL,
    "state" "PublishState" NOT NULL DEFAULT 'DRAFT',
    "source_event_id" UUID,
    "created_by_staff_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charge_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_charge_items" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "ChargeType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'UNPAID',
    "charge_batch_id" UUID,
    "source_event_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_charge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ,
    "location" TEXT,
    "audience_id" UUID NOT NULL,
    "state" "PublishState" NOT NULL DEFAULT 'DRAFT',
    "fee_amount" DECIMAL(12,2),
    "fee_mode" "FeeMode",
    "created_by_staff_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_participations" (
    "event_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "confirmed_by_parent_id" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ NOT NULL,
    "declined_at" TIMESTAMPTZ,

    CONSTRAINT "event_participations_pkey" PRIMARY KEY ("event_id","student_id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "momo_fee" DECIMAL(12,2) NOT NULL,
    "total_charged" DECIMAL(12,2) NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "transaction_ref" TEXT,
    "paid_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_charge_items" (
    "payment_id" UUID NOT NULL,
    "charge_item_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "amount_applied" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payment_charge_items_pkey" PRIMARY KEY ("payment_id","charge_item_id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "line_items" JSONB NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "student_id" UUID,
    "category" "NotificationCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ,
    "channel" "NotificationChannel" NOT NULL,
    "delivery_status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "link_type" TEXT,
    "link_id" TEXT,
    "resolves_when" JSONB,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh_key" TEXT NOT NULL,
    "auth_key" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schools_id_prefix_key" ON "schools"("id_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_username_key" ON "staff_users"("username");

-- CreateIndex
CREATE INDEX "staff_users_school_id_idx" ON "staff_users"("school_id");

-- CreateIndex
CREATE INDEX "parents_school_id_idx" ON "parents"("school_id");

-- CreateIndex
CREATE INDEX "parents_phone_idx" ON "parents"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "parents_school_id_phone_key" ON "parents"("school_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_staff_user_id_idx" ON "refresh_tokens"("staff_user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_parent_id_idx" ON "refresh_tokens"("parent_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "audit_logs_school_id_idx" ON "audit_logs"("school_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_staff_id_idx" ON "audit_logs"("actor_staff_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "grade_levels_school_id_idx" ON "grade_levels"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_levels_school_id_name_key" ON "grade_levels"("school_id", "name");

-- CreateIndex
CREATE INDEX "sections_school_id_idx" ON "sections"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_grade_level_id_name_key" ON "sections"("grade_level_id", "name");

-- CreateIndex
CREATE INDEX "students_school_id_idx" ON "students"("school_id");

-- CreateIndex
CREATE INDEX "students_section_id_idx" ON "students"("section_id");

-- CreateIndex
CREATE INDEX "students_school_id_status_idx" ON "students"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "students_school_id_student_code_key" ON "students"("school_id", "student_code");

-- CreateIndex
CREATE INDEX "parent_student_links_school_id_idx" ON "parent_student_links"("school_id");

-- CreateIndex
CREATE INDEX "parent_student_links_student_id_idx" ON "parent_student_links"("student_id");

-- CreateIndex
CREATE INDEX "subjects_school_id_idx" ON "subjects"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_school_id_name_normalized_key" ON "subjects"("school_id", "name_normalized");

-- CreateIndex
CREATE INDEX "grade_level_subjects_school_id_idx" ON "grade_level_subjects"("school_id");

-- CreateIndex
CREATE INDEX "subject_assignments_school_id_idx" ON "subject_assignments"("school_id");

-- CreateIndex
CREATE INDEX "subject_assignments_teacher_id_idx" ON "subject_assignments"("teacher_id");

-- CreateIndex
CREATE INDEX "subject_assignments_section_id_idx" ON "subject_assignments"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "subject_assignments_teacher_id_subject_id_section_id_key" ON "subject_assignments"("teacher_id", "subject_id", "section_id");

-- CreateIndex
CREATE INDEX "periods_school_id_idx" ON "periods"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "periods_school_id_number_key" ON "periods"("school_id", "number");

-- CreateIndex
CREATE INDEX "attendance_records_school_id_idx" ON "attendance_records"("school_id");

-- CreateIndex
CREATE INDEX "attendance_records_student_id_idx" ON "attendance_records"("student_id");

-- CreateIndex
CREATE INDEX "attendance_records_school_id_date_idx" ON "attendance_records"("school_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_student_id_date_key" ON "attendance_records"("student_id", "date");

-- CreateIndex
CREATE INDEX "grade_entries_school_id_idx" ON "grade_entries"("school_id");

-- CreateIndex
CREATE INDEX "grade_entries_student_id_idx" ON "grade_entries"("student_id");

-- CreateIndex
CREATE INDEX "grade_entries_period_id_idx" ON "grade_entries"("period_id");

-- CreateIndex
CREATE INDEX "grade_entries_school_id_period_id_state_idx" ON "grade_entries"("school_id", "period_id", "state");

-- CreateIndex
CREATE INDEX "grade_groups_school_id_idx" ON "grade_groups"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_groups_school_id_name_key" ON "grade_groups"("school_id", "name");

-- CreateIndex
CREATE INDEX "grade_group_grade_levels_school_id_idx" ON "grade_group_grade_levels"("school_id");

-- CreateIndex
CREATE INDEX "audiences_school_id_idx" ON "audiences"("school_id");

-- CreateIndex
CREATE INDEX "audience_snapshot_members_school_id_idx" ON "audience_snapshot_members"("school_id");

-- CreateIndex
CREATE INDEX "audience_snapshot_members_student_id_idx" ON "audience_snapshot_members"("student_id");

-- CreateIndex
CREATE INDEX "charge_batches_school_id_idx" ON "charge_batches"("school_id");

-- CreateIndex
CREATE INDEX "charge_batches_audience_id_idx" ON "charge_batches"("audience_id");

-- CreateIndex
CREATE INDEX "charge_batches_source_event_id_idx" ON "charge_batches"("source_event_id");

-- CreateIndex
CREATE INDEX "fee_charge_items_school_id_idx" ON "fee_charge_items"("school_id");

-- CreateIndex
CREATE INDEX "fee_charge_items_student_id_idx" ON "fee_charge_items"("student_id");

-- CreateIndex
CREATE INDEX "fee_charge_items_charge_batch_id_idx" ON "fee_charge_items"("charge_batch_id");

-- CreateIndex
CREATE INDEX "fee_charge_items_school_id_status_idx" ON "fee_charge_items"("school_id", "status");

-- CreateIndex
CREATE INDEX "events_school_id_idx" ON "events"("school_id");

-- CreateIndex
CREATE INDEX "events_audience_id_idx" ON "events"("audience_id");

-- CreateIndex
CREATE INDEX "event_participations_school_id_idx" ON "event_participations"("school_id");

-- CreateIndex
CREATE INDEX "event_participations_student_id_idx" ON "event_participations"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_transaction_ref_key" ON "payments"("transaction_ref");

-- CreateIndex
CREATE INDEX "payments_school_id_idx" ON "payments"("school_id");

-- CreateIndex
CREATE INDEX "payments_parent_id_idx" ON "payments"("parent_id");

-- CreateIndex
CREATE INDEX "payment_charge_items_school_id_idx" ON "payment_charge_items"("school_id");

-- CreateIndex
CREATE INDEX "payment_charge_items_charge_item_id_idx" ON "payment_charge_items"("charge_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_payment_id_key" ON "receipts"("payment_id");

-- CreateIndex
CREATE INDEX "receipts_school_id_idx" ON "receipts"("school_id");

-- CreateIndex
CREATE INDEX "notifications_school_id_idx" ON "notifications"("school_id");

-- CreateIndex
CREATE INDEX "notifications_parent_id_created_at_idx" ON "notifications"("parent_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_student_id_idx" ON "notifications"("student_id");

-- CreateIndex
CREATE INDEX "push_subscriptions_school_id_idx" ON "push_subscriptions"("school_id");

-- CreateIndex
CREATE INDEX "push_subscriptions_parent_id_idx" ON "push_subscriptions"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- AddForeignKey
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parents" ADD CONSTRAINT "parents_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "parents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_staff_id_fkey" FOREIGN KEY ("actor_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_parent_id_fkey" FOREIGN KEY ("actor_parent_id") REFERENCES "parents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_levels" ADD CONSTRAINT "grade_levels_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_grade_level_id_fkey" FOREIGN KEY ("grade_level_id") REFERENCES "grade_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "parents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_level_subjects" ADD CONSTRAINT "grade_level_subjects_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_level_subjects" ADD CONSTRAINT "grade_level_subjects_grade_level_id_fkey" FOREIGN KEY ("grade_level_id") REFERENCES "grade_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_level_subjects" ADD CONSTRAINT "grade_level_subjects_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_assignments" ADD CONSTRAINT "subject_assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_assignments" ADD CONSTRAINT "subject_assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_assignments" ADD CONSTRAINT "subject_assignments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_assignments" ADD CONSTRAINT "subject_assignments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periods" ADD CONSTRAINT "periods_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_recorded_by_staff_id_fkey" FOREIGN KEY ("recorded_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_entries" ADD CONSTRAINT "grade_entries_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_groups" ADD CONSTRAINT "grade_groups_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_group_grade_levels" ADD CONSTRAINT "grade_group_grade_levels_grade_group_id_fkey" FOREIGN KEY ("grade_group_id") REFERENCES "grade_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_group_grade_levels" ADD CONSTRAINT "grade_group_grade_levels_grade_level_id_fkey" FOREIGN KEY ("grade_level_id") REFERENCES "grade_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_group_grade_levels" ADD CONSTRAINT "grade_group_grade_levels_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audiences" ADD CONSTRAINT "audiences_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_snapshot_members" ADD CONSTRAINT "audience_snapshot_members_audience_id_fkey" FOREIGN KEY ("audience_id") REFERENCES "audiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_snapshot_members" ADD CONSTRAINT "audience_snapshot_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_snapshot_members" ADD CONSTRAINT "audience_snapshot_members_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_batches" ADD CONSTRAINT "charge_batches_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_batches" ADD CONSTRAINT "charge_batches_audience_id_fkey" FOREIGN KEY ("audience_id") REFERENCES "audiences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_batches" ADD CONSTRAINT "charge_batches_source_event_id_fkey" FOREIGN KEY ("source_event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_batches" ADD CONSTRAINT "charge_batches_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_charge_items" ADD CONSTRAINT "fee_charge_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_charge_items" ADD CONSTRAINT "fee_charge_items_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_charge_items" ADD CONSTRAINT "fee_charge_items_charge_batch_id_fkey" FOREIGN KEY ("charge_batch_id") REFERENCES "charge_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_charge_items" ADD CONSTRAINT "fee_charge_items_source_event_id_fkey" FOREIGN KEY ("source_event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_audience_id_fkey" FOREIGN KEY ("audience_id") REFERENCES "audiences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participations" ADD CONSTRAINT "event_participations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participations" ADD CONSTRAINT "event_participations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participations" ADD CONSTRAINT "event_participations_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participations" ADD CONSTRAINT "event_participations_confirmed_by_parent_id_fkey" FOREIGN KEY ("confirmed_by_parent_id") REFERENCES "parents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "parents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_charge_items" ADD CONSTRAINT "payment_charge_items_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_charge_items" ADD CONSTRAINT "payment_charge_items_charge_item_id_fkey" FOREIGN KEY ("charge_item_id") REFERENCES "fee_charge_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_charge_items" ADD CONSTRAINT "payment_charge_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "parents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "parents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
