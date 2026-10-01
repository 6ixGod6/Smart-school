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
  if (!covering) {
    throw badRequest("No academic period covers this date — create or extend the period first.");
  }
  const closed = periodIsClosed(covering.endDate);
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

  const parsed = input.records.map((row) => ({
    studentId: row.studentId,
    status: parseStatus(row.status),
  }));

  const sectionStudents = await prisma.student.findMany({
    where: { sectionId, schoolId },
    select: { id: true },
  });
  const inSection = new Set(sectionStudents.map((row) => row.id));
  for (const row of parsed) {
    if (!inSection.has(row.studentId)) {
      throw forbidden("Student is not in this section.");
    }
  }

  const studentIds = parsed.map((row) => row.studentId);
  const recorderId = auth.kind === "staff" ? auth.id : null;

  return prisma.$transaction(
    async (tx) => {
      const existingRows = await tx.attendanceRecord.findMany({
        where: { schoolId, date, studentId: { in: studentIds } },
      });
      const existingByStudent = new Map(existingRows.map((row) => [row.studentId, row]));
      const results: AttendanceRow[] = [];

      for (const row of parsed) {
        const existing = existingByStudent.get(row.studentId);
        const saved = await tx.attendanceRecord.upsert({
          where: { studentId_date: { studentId: row.studentId, date } },
          create: {
            schoolId,
            studentId: row.studentId,
            date,
            status: row.status,
            recordedByStaffId: recorderId,
          },
          update: {
            status: row.status,
            recordedByStaffId: recorderId,
          },
        });
        if (existing && existing.status !== row.status) {
          await writeAudit(tx, {
            schoolId,
            actorStaffId: auth.id,
            action: closed ? "ATTENDANCE_CLOSED_PERIOD_AMENDED" : "ATTENDANCE_AMENDED",
            entityType: "attendance_record",
            entityId: saved.id,
            metadata: {
              studentId: row.studentId,
              date: dateOnlyString(date),
              oldStatus: existing.status,
              newStatus: row.status,
              reason: closed ? reason : reason || undefined,
              periodId: covering.id,
            },
          });
        }
        results.push(saved);
      }
      return results;
    },
    { timeout: 20_000 },
  );
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
