import type { PrismaClient } from "@smart-school/shared";
import type { AuthPrincipal } from "@smart-school/shared";
import { badRequest, forbidden } from "../http.ts";

type AcademicYearRow = {
  id: string;
  schoolId: string;
  label: string;
  startDate: Date;
  endDate: Date;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
  createdAt: Date;
};

type EnrollmentRow = {
  id: string;
  schoolId: string;
  studentId: string;
  academicYearId: string;
  sectionId: string;
  outcome: "PENDING" | "PROMOTED" | "REPEATING" | "GRADUATED" | "WITHDRAWN" | "TRANSFERRED";
  enrolledAt: Date;
  outcomeSetAt: Date | null;
  outcomeSetByStaffId: string | null;
};

export async function requireActiveYear(prisma: PrismaClient, schoolId: string): Promise<AcademicYearRow> {
  const year = await prisma.academicYear.findFirst({
    where: { schoolId, status: "ACTIVE" },
  });
  if (!year) {
    throw badRequest("This school has no active academic year.");
  }
  return year;
}

export async function yearCoveringDate(
  prisma: PrismaClient,
  schoolId: string,
  date: Date,
): Promise<AcademicYearRow | null> {
  return prisma.academicYear.findFirst({
    where: { schoolId, startDate: { lte: date }, endDate: { gte: date } },
  });
}

/** Teacher reads must resolve to one year and never return dates outside it. */
export async function resolveTeacherAttendanceWindow(
  prisma: PrismaClient,
  schoolId: string,
  requestedFrom?: Date,
  requestedTo?: Date,
): Promise<{ year: AcademicYearRow; from: Date; to: Date }> {
  const year = requestedFrom
    ? await yearCoveringDate(prisma, schoolId, requestedFrom)
    : await requireActiveYear(prisma, schoolId);
  if (!year) {
    throw badRequest("from is not inside any academic year at this school.");
  }

  const from = requestedFrom ?? year.startDate;
  const to = requestedTo ?? year.endDate;
  if (to < from) {
    throw badRequest("to must be on or after from.");
  }

  const spanning = await prisma.academicYear.count({
    where: {
      schoolId,
      startDate: { lte: to },
      endDate: { gte: from },
    },
  });
  if (spanning > 1) {
    throw badRequest("This date range spans more than one academic year. Query one year at a time.");
  }

  const clampedFrom = from < year.startDate ? year.startDate : from;
  const clampedTo = to > year.endDate ? year.endDate : to;
  return { year, from: clampedFrom, to: clampedTo };
}

export async function listAcademicYears(prisma: PrismaClient, schoolId: string): Promise<AcademicYearRow[]> {
  return prisma.academicYear.findMany({
    where: { schoolId },
    orderBy: { startDate: "desc" },
  });
}

export async function enrollmentInYear(
  prisma: PrismaClient,
  schoolId: string,
  studentId: string,
  academicYearId: string,
): Promise<EnrollmentRow | null> {
  return prisma.enrollment.findFirst({
    where: { schoolId, studentId, academicYearId },
  });
}

export async function studentIdsInSectionForYear(
  prisma: PrismaClient,
  schoolId: string,
  sectionId: string,
  academicYearId: string,
): Promise<string[]> {
  const rows = await prisma.enrollment.findMany({
    where: { schoolId, sectionId, academicYearId },
    select: { studentId: true },
  });
  return rows.map((row) => row.studentId);
}

export async function assertTeacherAssignedToSectionInYear(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  sectionId: string,
  academicYearId: string,
): Promise<void> {
  if (auth.role === "school_admin" || auth.role === "super_admin") return;
  if (auth.role !== "teacher" || auth.kind !== "staff") {
    throw forbidden("Insufficient role for this action.");
  }
  const hit = await prisma.subjectAssignment.findFirst({
    where: { schoolId, sectionId, academicYearId, teacherId: auth.id },
    select: { id: true },
  });
  if (!hit) {
    throw forbidden("You are not assigned to this section.");
  }
}
