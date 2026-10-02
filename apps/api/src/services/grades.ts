import type { PrismaClient } from "@smart-school/shared";
import type { AuthPrincipal } from "@smart-school/shared";
import { writeAudit } from "../auth/audit.ts";
import { dateOnlyString } from "../dates.ts";
import { badRequest, conflict, forbidden, notFound } from "../http.ts";
import { parentMaySeeStudent } from "../middleware/tenancy.ts";
import { getSchoolSettings } from "./settings.ts";
import {
  assertTeacherAssignedToSubjectInYear,
  assertYearAllowsAcademicWrites,
  enrollmentInYear,
} from "./years.ts";

const TYPES = new Set(["QUIZ", "TEST", "HOMEWORK", "EXAM"]);
const SUBMITTED_OR_LATER = ["SUBMITTED", "APPROVED", "PUBLISHED"] as const;

type GradeState = "DRAFT" | "SUBMITTED" | "APPROVED" | "PUBLISHED";
type AssessmentType = "QUIZ" | "TEST" | "HOMEWORK" | "EXAM";

type GradeRow = {
  id: string;
  schoolId: string;
  studentId: string;
  subjectId: string;
  periodId: string;
  assessmentType: AssessmentType;
  sequence: number;
  score: string;
  state: GradeState;
  version: number;
  underReview: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  countsTowardTally: boolean;
};

function parseType(value: string): AssessmentType {
  if (!TYPES.has(value)) throw badRequest("assessmentType must be QUIZ, TEST, HOMEWORK, or EXAM.");
  return value as AssessmentType;
}

function parseScore(value: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 100) {
    throw badRequest("score must be a number between 0 and 100.");
  }
  return Math.round(value * 100) / 100;
}

function parseSequence(value: number | undefined): number {
  const sequence = value ?? 1;
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 2) {
    throw badRequest("sequence must be 1 or 2.");
  }
  return sequence;
}

function asGradeRow(
  row: {
    id: string;
    schoolId: string;
    studentId: string;
    subjectId: string;
    periodId: string;
    assessmentType: AssessmentType;
    sequence: number;
    score: { toString(): string };
    state: GradeState;
    version: number;
    underReview: boolean;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  countsTowardTally: boolean,
): GradeRow {
  return {
    id: row.id,
    schoolId: row.schoolId,
    studentId: row.studentId,
    subjectId: row.subjectId,
    periodId: row.periodId,
    assessmentType: row.assessmentType,
    sequence: row.sequence,
    score: row.score.toString(),
    state: row.state,
    version: row.version,
    underReview: row.underReview,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    countsTowardTally,
  };
}

function deadlinePassed(deadline: Date, now = new Date()): boolean {
  return deadline.getTime() < now.getTime();
}

async function assertDeadlineWrite(
  auth: AuthPrincipal,
  period: { gradeEntryDeadline: Date; id: string },
  reason?: string,
): Promise<string> {
  if (!deadlinePassed(period.gradeEntryDeadline)) return "";
  if (auth.role === "teacher") {
    throw forbidden("The grade-entry deadline for this period has passed.");
  }
  const trimmed = reason?.trim() ?? "";
  if ((auth.role === "school_admin" || auth.role === "super_admin") && trimmed.length === 0) {
    throw badRequest("A reason is required to enter or amend grades after the deadline.");
  }
  return trimmed;
}

async function loadPeriod(prisma: PrismaClient, schoolId: string, periodId: string) {
  const period = await prisma.period.findFirst({ where: { id: periodId, schoolId } });
  if (!period) throw notFound();
  return period;
}

async function assertStudentMayReceiveGrade(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  studentId: string,
  subjectId: string,
  period: { id: string; academicYearId: string; type: "REGULAR" | "SUMMER" },
): Promise<{ sectionId: string; gradeLevelId: string }> {
  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId } });
  if (!student) throw notFound();
  const enrollment = await enrollmentInYear(prisma, schoolId, student.id, period.academicYearId);
  if (!enrollment) {
    throw badRequest("Student is not enrolled in this period's academic year.");
  }
  const section = await prisma.section.findFirst({ where: { id: enrollment.sectionId, schoolId } });
  if (!section) throw notFound();
  const mapped = await prisma.gradeLevelSubject.findFirst({
    where: { schoolId, gradeLevelId: section.gradeLevelId, subjectId },
  });
  if (!mapped) {
    throw badRequest("This subject is not mapped to the student's grade level.");
  }
  await assertTeacherAssignedToSubjectInYear(
    prisma,
    auth,
    schoolId,
    section.id,
    subjectId,
    period.academicYearId,
  );
  return { sectionId: section.id, gradeLevelId: section.gradeLevelId };
}

function parentMaySeePublished(
  row: { state: GradeState; publishedAt: Date | null },
  graceHours: number,
  timing: "IMMEDIATE" | "GRACE_WINDOW",
  now = new Date(),
): boolean {
  if (row.state !== "PUBLISHED" || !row.publishedAt) return false;
  const waitMs = timing === "GRACE_WINDOW" ? graceHours * 60 * 60 * 1000 : 0;
  return row.publishedAt.getTime() + waitMs <= now.getTime();
}

export async function upsertDraftGrade(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  input: {
    studentId: string;
    subjectId: string;
    periodId: string;
    assessmentType: string;
    sequence?: number;
    score: number;
    reason?: string;
  },
): Promise<GradeRow> {
  if (auth.role === "parent") throw forbidden("Parents cannot enter grades.");
  const period = await loadPeriod(prisma, schoolId, input.periodId);
  await assertYearAllowsAcademicWrites(prisma, schoolId, period.academicYearId);
  await assertStudentMayReceiveGrade(prisma, auth, schoolId, input.studentId, input.subjectId, period);
  const reason = await assertDeadlineWrite(auth, period, input.reason);
  const assessmentType = parseType(input.assessmentType);
  const sequence = parseSequence(input.sequence);
  const score = parseScore(input.score);

  const latest = await prisma.gradeEntry.findFirst({
    where: {
      schoolId,
      studentId: input.studentId,
      subjectId: input.subjectId,
      periodId: period.id,
      assessmentType,
      sequence,
    },
    orderBy: { version: "desc" },
  });
  if (latest && latest.state !== "DRAFT") {
    throw conflict("GRADE_NOT_DRAFT", "This grade is no longer a draft. Correct a published score to create a new version.");
  }

  const saved = latest
    ? await prisma.gradeEntry.update({
        where: { id: latest.id },
        data: { score },
      })
    : await prisma.gradeEntry.create({
        data: {
          schoolId,
          studentId: input.studentId,
          subjectId: input.subjectId,
          periodId: period.id,
          assessmentType,
          sequence,
          score,
          state: "DRAFT",
          version: 1,
        },
      });

  if (reason) {
    await writeAudit(prisma, {
      schoolId,
      actorStaffId: auth.id,
      action: "GRADE_DEADLINE_AMENDED",
      entityType: "grade_entry",
      entityId: saved.id,
      metadata: { reason, score, periodId: period.id, studentId: input.studentId },
    });
  }
  return asGradeRow(saved, period.type !== "SUMMER");
}

export async function submitGrade(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  gradeId: string,
  reason?: string,
): Promise<GradeRow> {
  if (auth.role === "parent") throw forbidden();
  const existing = await prisma.gradeEntry.findFirst({ where: { id: gradeId, schoolId } });
  if (!existing) throw notFound();
  const period = await loadPeriod(prisma, schoolId, existing.periodId);
  await assertYearAllowsAcademicWrites(prisma, schoolId, period.academicYearId);
  await assertStudentMayReceiveGrade(prisma, auth, schoolId, existing.studentId, existing.subjectId, period);
  const deadlineReason = await assertDeadlineWrite(auth, period, reason);
  if (existing.state !== "DRAFT") {
    throw conflict("GRADE_NOT_DRAFT", "Only a draft grade can be submitted.");
  }
  const saved = await prisma.gradeEntry.update({
    where: { id: existing.id },
    data: { state: "SUBMITTED" },
  });
  await writeAudit(prisma, {
    schoolId,
    actorStaffId: auth.id,
    action: "GRADE_SUBMITTED",
    entityType: "grade_entry",
    entityId: saved.id,
    metadata: { periodId: period.id, studentId: existing.studentId, reason: deadlineReason || undefined },
  });
  return asGradeRow(saved, period.type !== "SUMMER");
}

export async function approveGrade(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  gradeId: string,
): Promise<GradeRow> {
  if (auth.role !== "school_admin" && auth.role !== "super_admin") {
    throw forbidden("Only a school admin can approve grades.");
  }
  const existing = await prisma.gradeEntry.findFirst({ where: { id: gradeId, schoolId } });
  if (!existing) throw notFound();
  const period = await loadPeriod(prisma, schoolId, existing.periodId);
  await assertYearAllowsAcademicWrites(prisma, schoolId, period.academicYearId);
  if (existing.state !== "SUBMITTED") {
    throw conflict("GRADE_NOT_SUBMITTED", "Only a submitted grade can be approved.");
  }
  const saved = await prisma.gradeEntry.update({
    where: { id: existing.id },
    data: { state: "APPROVED" },
  });
  await writeAudit(prisma, {
    schoolId,
    actorStaffId: auth.id,
    action: "GRADE_APPROVED",
    entityType: "grade_entry",
    entityId: saved.id,
    metadata: { periodId: period.id, studentId: existing.studentId },
  });
  return asGradeRow(saved, period.type !== "SUMMER");
}

export async function publishGradeCohort(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  input: {
    periodId: string;
    sectionId?: string;
    gradeLevelId?: string;
    studentIds?: unknown;
    students?: unknown;
    studentId?: unknown;
  },
): Promise<{ published: number }> {
  if (auth.role !== "school_admin" && auth.role !== "super_admin") {
    throw forbidden("Only a school admin can publish grades.");
  }
  if (input.studentIds !== undefined || "students" in input || "studentId" in input) {
    throw badRequest("Publishing cannot target individual students. Choose a section or a grade level.");
  }
  if (input.sectionId && input.gradeLevelId) {
    throw badRequest("Choose a section or a grade level, not both.");
  }
  if (!input.sectionId && !input.gradeLevelId) {
    throw badRequest("sectionId or gradeLevelId is required.");
  }

  const period = await loadPeriod(prisma, schoolId, input.periodId);
  await assertYearAllowsAcademicWrites(prisma, schoolId, period.academicYearId);
  const settings = await getSchoolSettings(prisma, schoolId);
  if (settings.gradeCadence === "END_OF_PERIOD") {
    if (dateOnlyString(period.endDate) > dateOnlyString(new Date())) {
      throw badRequest("This school publishes grades only after the period ends.");
    }
  }

  let studentIds: string[];
  if (input.sectionId) {
    const section = await prisma.section.findFirst({ where: { id: input.sectionId, schoolId } });
    if (!section) throw notFound();
    const rows = await prisma.enrollment.findMany({
      where: { schoolId, sectionId: section.id, academicYearId: period.academicYearId },
      select: { studentId: true },
    });
    studentIds = rows.map((row) => row.studentId);
  } else {
    const gradeLevel = await prisma.gradeLevel.findFirst({ where: { id: input.gradeLevelId, schoolId } });
    if (!gradeLevel) throw notFound();
    const sections = await prisma.section.findMany({
      where: { schoolId, gradeLevelId: gradeLevel.id },
      select: { id: true },
    });
    const rows = await prisma.enrollment.findMany({
      where: {
        schoolId,
        academicYearId: period.academicYearId,
        sectionId: { in: sections.map((row) => row.id) },
      },
      select: { studentId: true },
    });
    studentIds = rows.map((row) => row.studentId);
  }

  if (studentIds.length === 0) {
    return { published: 0 };
  }

  const now = new Date();
  const result = await prisma.gradeEntry.updateMany({
    where: {
      schoolId,
      periodId: period.id,
      studentId: { in: studentIds },
      state: "APPROVED",
    },
    data: { state: "PUBLISHED", publishedAt: now },
  });

  await writeAudit(prisma, {
    schoolId,
    actorStaffId: auth.id,
    action: "GRADE_COHORT_PUBLISHED",
    entityType: "period",
    entityId: period.id,
    metadata: {
      sectionId: input.sectionId ?? null,
      gradeLevelId: input.gradeLevelId ?? null,
      published: result.count,
    },
  });
  return { published: result.count };
}

export async function setGradeUnderReview(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  gradeId: string,
  underReview: boolean,
): Promise<GradeRow> {
  if (auth.role !== "school_admin" && auth.role !== "super_admin") {
    throw forbidden("Only a school admin can mark a grade under review.");
  }
  const existing = await prisma.gradeEntry.findFirst({ where: { id: gradeId, schoolId } });
  if (!existing) throw notFound();
  const period = await loadPeriod(prisma, schoolId, existing.periodId);
  const saved = await prisma.gradeEntry.update({
    where: { id: existing.id },
    data: { underReview },
  });
  await writeAudit(prisma, {
    schoolId,
    actorStaffId: auth.id,
    action: underReview ? "GRADE_UNDER_REVIEW" : "GRADE_REVIEW_CLEARED",
    entityType: "grade_entry",
    entityId: saved.id,
    metadata: { studentId: existing.studentId },
  });
  return asGradeRow(saved, period.type !== "SUMMER");
}

export async function correctPublishedGrade(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  gradeId: string,
  input: { score: number; reason: string },
): Promise<GradeRow> {
  if (auth.role !== "school_admin" && auth.role !== "super_admin") {
    throw forbidden("Only a school admin can correct a published grade.");
  }
  const reason = input.reason.trim();
  if (!reason) throw badRequest("A reason is required to correct a published grade.");
  const existing = await prisma.gradeEntry.findFirst({ where: { id: gradeId, schoolId } });
  if (!existing) throw notFound();
  if (existing.state !== "PUBLISHED") {
    throw badRequest("Only a published grade can be corrected this way.");
  }
  const period = await loadPeriod(prisma, schoolId, existing.periodId);
  await assertYearAllowsAcademicWrites(prisma, schoolId, period.academicYearId);
  const score = parseScore(input.score);
  const created = await prisma.gradeEntry.create({
    data: {
      schoolId,
      studentId: existing.studentId,
      subjectId: existing.subjectId,
      periodId: existing.periodId,
      assessmentType: existing.assessmentType,
      sequence: existing.sequence,
      score,
      state: "DRAFT",
      version: existing.version + 1,
      underReview: false,
    },
  });
  await writeAudit(prisma, {
    schoolId,
    actorStaffId: auth.id,
    action: "GRADE_CORRECTED",
    entityType: "grade_entry",
    entityId: created.id,
    metadata: {
      previousGradeId: existing.id,
      previousVersion: existing.version,
      previousScore: existing.score.toString(),
      newScore: score,
      reason,
      notifyParent: true,
      studentId: existing.studentId,
    },
  });
  return asGradeRow(created, period.type !== "SUMMER");
}

export async function listStudentGrades(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  studentId: string,
  periodId?: string,
): Promise<Array<Omit<GradeRow, "score"> & { score: string | null; underReviewLabel?: string }>> {
  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId } });
  if (!student) throw notFound();

  if (auth.role === "parent") {
    parentMaySeeStudent(auth, student.id, student.status);
  } else if (auth.role === "teacher") {
    const enrollments = await prisma.enrollment.findMany({
      where: { schoolId, studentId: student.id },
      select: { sectionId: true, academicYearId: true },
    });
    const assigned =
      enrollments.length === 0
        ? null
        : await prisma.subjectAssignment.findFirst({
            where: {
              schoolId,
              teacherId: auth.id,
              OR: enrollments.map((row) => ({ sectionId: row.sectionId, academicYearId: row.academicYearId })),
            },
            select: { id: true },
          });
    if (!assigned) throw forbidden("You are not assigned to this student's section.");
  } else if (auth.role !== "school_admin" && auth.role !== "super_admin") {
    throw forbidden();
  }

  const rows = await prisma.gradeEntry.findMany({
    where: { schoolId, studentId, ...(periodId ? { periodId } : {}) },
    include: { period: { select: { type: true } } },
    orderBy: [{ periodId: "asc" }, { subjectId: "asc" }, { assessmentType: "asc" }, { sequence: "asc" }, { version: "desc" }],
  });

  if (auth.role !== "parent") {
    return rows.map((row) => asGradeRow(row, row.period.type !== "SUMMER"));
  }

  const settings = await getSchoolSettings(prisma, schoolId);
  const visible: Array<Omit<GradeRow, "score"> & { score: string | null; underReviewLabel?: string }> = [];
  for (const row of rows) {
    if (!parentMaySeePublished(row, settings.publishGraceHours, settings.publishTiming)) continue;
    const base = asGradeRow(row, row.period.type !== "SUMMER");
    if (row.underReview) {
      visible.push({ ...base, score: null, underReviewLabel: "under review" });
    } else {
      visible.push(base);
    }
  }
  return visible;
}

export async function missingSubmissions(
  prisma: PrismaClient,
  schoolId: string,
  periodId: string,
): Promise<
  Array<{
    sectionId: string;
    sectionName: string;
    subjectId: string;
    subjectName: string;
    teacherId: string;
    teacherEmail: string;
  }>
> {
  const period = await loadPeriod(prisma, schoolId, periodId);
  const assignments = await prisma.subjectAssignment.findMany({
    where: { schoolId, academicYearId: period.academicYearId },
    include: {
      section: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
      teacher: { select: { id: true, email: true } },
    },
  });

  const missing: Array<{
    sectionId: string;
    sectionName: string;
    subjectId: string;
    subjectName: string;
    teacherId: string;
    teacherEmail: string;
  }> = [];

  for (const assignment of assignments) {
    const enrolled = await prisma.enrollment.findMany({
      where: { schoolId, academicYearId: period.academicYearId, sectionId: assignment.sectionId },
      select: { studentId: true },
    });
    if (enrolled.length === 0) {
      missing.push({
        sectionId: assignment.section.id,
        sectionName: assignment.section.name,
        subjectId: assignment.subject.id,
        subjectName: assignment.subject.name,
        teacherId: assignment.teacher.id,
        teacherEmail: assignment.teacher.email,
      });
      continue;
    }
    const submitted = await prisma.gradeEntry.count({
      where: {
        schoolId,
        periodId: period.id,
        subjectId: assignment.subjectId,
        studentId: { in: enrolled.map((row) => row.studentId) },
        state: { in: [...SUBMITTED_OR_LATER] },
      },
    });
    if (submitted === 0) {
      missing.push({
        sectionId: assignment.section.id,
        sectionName: assignment.section.name,
        subjectId: assignment.subject.id,
        subjectName: assignment.subject.name,
        teacherId: assignment.teacher.id,
        teacherEmail: assignment.teacher.email,
      });
    }
  }
  return missing;
}
