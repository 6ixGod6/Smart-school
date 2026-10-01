import type { PrismaClient } from "@smart-school/shared";
import type { AuthPrincipal } from "@smart-school/shared";
import { writeAudit } from "../auth/audit.ts";
import { dateOnlyString, parseDateOnly } from "../dates.ts";
import { badRequest, forbidden, notFound } from "../http.ts";
import { assertTeacherAssignedToSection, parentMaySeeStudent } from "../middleware/tenancy.ts";
import { periodCoveringDate, periodIsClosed } from "./periods.ts";

const STATUSES = new Set(["PRESENT", "ABSENT", "LATE"]);

type AttendanceRow = {
  id: string;
  schoolId: string;
  studentId: string;
  date: Date;
  status: "PRESENT" | "ABSENT" | "LATE";
  recordedByStaffId: string | null;
  createdAt: Date;
};

function parseStatus(value: string): "PRESENT" | "ABSENT" | "LATE" {
  if (!STATUSES.has(value)) throw badRequest("status must be PRESENT, ABSENT, or LATE.");
  return value as "PRESENT" | "ABSENT" | "LATE";
}

export async function markSectionAttendance(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  sectionId: string,
  input: { date: string; records: Array<{ studentId: string; status: string }>; reason?: string },
): Promise<AttendanceRow[]> {
  if (auth.role === "parent") throw forbidden("Parents cannot mark attendance.");
  assertTeacherAssignedToSection(auth, sectionId);

  const section = await prisma.section.findFirst({ where: { id: sectionId, schoolId } });
  if (!section) throw notFound();

  const date = parseDateOnly(input.date);
  const covering = await periodCoveringDate(prisma, schoolId, date);
  const closed = covering ? periodIsClosed(covering.endDate) : false;
  const reason = input.reason?.trim() ?? "";

  if (closed && auth.role === "teacher") {
    throw forbidden("This period is closed. A school admin must amend attendance.");
  }
  if (closed && (auth.role === "school_admin" || auth.role === "super_admin") && reason.length === 0) {
    throw badRequest("A reason is required to amend attendance in a closed period.");
  }

  if (!Array.isArray(input.records) || input.records.length === 0) {
    throw badRequest("records must be a non-empty list.");
  }

  const sectionStudents = await prisma.student.findMany({
    where: { sectionId, schoolId },
    select: { id: true },
  });
  const inSection = new Set(sectionStudents.map((row) => row.id));

  const results = [];
  for (const row of input.records) {
    if (!inSection.has(row.studentId)) {
      throw forbidden("Student is not in this section.");
    }
    const status = parseStatus(row.status);
    const existing = await prisma.attendanceRecord.findUnique({
      where: { studentId_date: { studentId: row.studentId, date } },
    });
    const saved = await prisma.attendanceRecord.upsert({
      where: { studentId_date: { studentId: row.studentId, date } },
      create: {
        schoolId,
        studentId: row.studentId,
        date,
        status,
        recordedByStaffId: auth.kind === "staff" ? auth.id : null,
      },
      update: {
        status,
        recordedByStaffId: auth.kind === "staff" ? auth.id : null,
      },
    });
    if (closed && existing && existing.status !== status) {
      await writeAudit(prisma, {
        schoolId,
        actorStaffId: auth.id,
        action: "ATTENDANCE_CLOSED_PERIOD_AMENDED",
        entityType: "attendance_record",
        entityId: saved.id,
        metadata: {
          studentId: row.studentId,
          date: dateOnlyString(date),
          oldStatus: existing.status,
          newStatus: status,
          reason,
          periodId: covering?.id,
        },
      });
    } else if (closed && !existing) {
      await writeAudit(prisma, {
        schoolId,
        actorStaffId: auth.id,
        action: "ATTENDANCE_CLOSED_PERIOD_AMENDED",
        entityType: "attendance_record",
        entityId: saved.id,
        metadata: {
          studentId: row.studentId,
          date: dateOnlyString(date),
          oldStatus: null,
          newStatus: status,
          reason,
          periodId: covering?.id,
        },
      });
    }
    results.push(saved);
  }
  return results;
}

export async function listSectionAttendance(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  sectionId: string,
  dateStr: string,
): Promise<AttendanceRow[]> {
  if (auth.role === "parent") throw forbidden("Parents cannot list a section.");
  assertTeacherAssignedToSection(auth, sectionId);
  const section = await prisma.section.findFirst({ where: { id: sectionId, schoolId } });
  if (!section) throw notFound();
  const date = parseDateOnly(dateStr);
  return prisma.attendanceRecord.findMany({
    where: { schoolId, date, student: { sectionId } },
    orderBy: { studentId: "asc" },
  });
}

export async function listStudentAttendance(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  studentId: string,
  fromStr?: string,
  toStr?: string,
): Promise<AttendanceRow[]> {
  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId } });
  if (!student) throw notFound();

  if (auth.role === "parent") {
    parentMaySeeStudent(auth, student.id, student.status);
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school?.attendanceVisibleToParents) {
      throw forbidden("Attendance is not visible to parents at this school.");
    }
  } else if (auth.role === "teacher") {
    assertTeacherAssignedToSection(auth, student.sectionId);
  } else if (auth.role !== "school_admin" && auth.role !== "super_admin") {
    throw forbidden();
  }

  const from = fromStr ? parseDateOnly(fromStr, "from") : undefined;
  const to = toStr ? parseDateOnly(toStr, "to") : undefined;
  return prisma.attendanceRecord.findMany({
    where: {
      schoolId,
      studentId,
      ...(from || to
        ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    orderBy: { date: "asc" },
  });
}
