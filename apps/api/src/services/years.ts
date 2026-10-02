import type { PrismaClient } from "@smart-school/shared";
import type { AuthPrincipal } from "@smart-school/shared";
import { writeAudit } from "../auth/audit.ts";
import { parseDateOnly } from "../dates.ts";
import { badRequest, conflict, forbidden, notFound } from "../http.ts";

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

export async function assertTeacherAssignedToSubjectInYear(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  sectionId: string,
  subjectId: string,
  academicYearId: string,
): Promise<void> {
  if (auth.role === "school_admin" || auth.role === "super_admin") return;
  if (auth.role !== "teacher" || auth.kind !== "staff") {
    throw forbidden("Insufficient role for this action.");
  }
  const hit = await prisma.subjectAssignment.findFirst({
    where: { schoolId, sectionId, subjectId, academicYearId, teacherId: auth.id },
    select: { id: true },
  });
  if (!hit) {
    throw forbidden("You are not assigned to this subject in this section.");
  }
}

function errorCodes(err: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = err;
  for (let i = 0; i < 8 && current; i += 1) {
    if (typeof current === "object" && current && "code" in current) {
      codes.push(String((current as { code: unknown }).code));
    }
    if (current instanceof Error) {
      const fromMessage = current.message.match(/\b(23P01|23505|23503|23514)\b/g);
      if (fromMessage) codes.push(...fromMessage);
    }
    current =
      typeof current === "object" && current && "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
  }
  return codes;
}

export async function assertYearAllowsAcademicWrites(
  prisma: PrismaClient,
  schoolId: string,
  academicYearId: string,
): Promise<AcademicYearRow> {
  const year = await prisma.academicYear.findFirst({ where: { id: academicYearId, schoolId } });
  if (!year) throw notFound();
  if (year.status === "CLOSED") {
    throw forbidden("This academic year is closed. Attendance and grades cannot be changed.");
  }
  return year;
}

export async function pendingEnrollmentCount(
  prisma: PrismaClient,
  schoolId: string,
  academicYearId: string,
): Promise<number> {
  return prisma.enrollment.count({
    where: { schoolId, academicYearId, outcome: "PENDING" },
  });
}

export async function createAcademicYear(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  input: { label: string; startDate: string; endDate: string },
): Promise<AcademicYearRow> {
  const label = input.label.trim();
  if (!label) throw badRequest("label is required.");
  const startDate = parseDateOnly(input.startDate, "startDate");
  const endDate = parseDateOnly(input.endDate, "endDate");
  if (endDate < startDate) {
    throw badRequest("endDate must be on or after startDate.");
  }
  try {
    const year = await prisma.academicYear.create({
      data: { schoolId, label, startDate, endDate, status: "PLANNED" },
    });
    await writeAudit(prisma, {
      schoolId,
      actorStaffId: auth.id,
      action: "ACADEMIC_YEAR_CREATED",
      entityType: "academic_year",
      entityId: year.id,
      metadata: { label, startDate: input.startDate, endDate: input.endDate },
    });
    return year;
  } catch (err) {
    const codes = errorCodes(err);
    if (codes.includes("P2002") || codes.includes("23505")) {
      throw conflict("YEAR_LABEL_TAKEN", `An academic year labeled ${label} already exists at this school.`);
    }
    if (codes.includes("23P01") || codes.includes("P2039") || codes.includes("P2010")) {
      throw conflict("YEAR_OVERLAP", "This date range overlaps another academic year at this school.");
    }
    throw err;
  }
}

export async function updateAcademicYear(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  yearId: string,
  input: { label?: string; startDate?: string; endDate?: string },
): Promise<AcademicYearRow> {
  const existing = await prisma.academicYear.findFirst({ where: { id: yearId, schoolId } });
  if (!existing) throw notFound();
  if (existing.status !== "PLANNED") {
    throw forbidden("Only a planned academic year can be edited.");
  }
  const label = input.label !== undefined ? input.label.trim() : existing.label;
  if (!label) throw badRequest("label is required.");
  const startDate = input.startDate ? parseDateOnly(input.startDate, "startDate") : existing.startDate;
  const endDate = input.endDate ? parseDateOnly(input.endDate, "endDate") : existing.endDate;
  if (endDate < startDate) {
    throw badRequest("endDate must be on or after startDate.");
  }
  try {
    const year = await prisma.academicYear.update({
      where: { id: existing.id },
      data: { label, startDate, endDate },
    });
    await writeAudit(prisma, {
      schoolId,
      actorStaffId: auth.id,
      action: "ACADEMIC_YEAR_UPDATED",
      entityType: "academic_year",
      entityId: year.id,
      metadata: { label, startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    });
    return year;
  } catch (err) {
    const codes = errorCodes(err);
    if (codes.includes("P2002") || codes.includes("23505")) {
      throw conflict("YEAR_LABEL_TAKEN", `An academic year labeled ${label} already exists at this school.`);
    }
    if (codes.includes("23P01") || codes.includes("P2039") || codes.includes("P2010")) {
      throw conflict("YEAR_OVERLAP", "This date range overlaps another academic year at this school.");
    }
    throw err;
  }
}

type CloseOverride = { override?: boolean; reason?: string };

async function closeYearRow(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  year: AcademicYearRow,
  override: CloseOverride,
): Promise<AcademicYearRow> {
  const pending = await pendingEnrollmentCount(prisma, year.schoolId, year.id);
  const reason = override.reason?.trim() ?? "";
  if (pending > 0 && !override.override) {
    throw conflict(
      "YEAR_HAS_PENDING",
      `${pending} student${pending === 1 ? "" : "s"} in ${year.label} still have no outcome.`,
      { pendingCount: pending, label: year.label },
    );
  }
  if (pending > 0 && reason.length === 0) {
    throw badRequest("A reason is required to close a year that still has pending outcomes.");
  }
  const closed = await prisma.academicYear.update({
    where: { id: year.id },
    data: { status: "CLOSED" },
  });
  await writeAudit(prisma, {
    schoolId: year.schoolId,
    actorStaffId: auth.id,
    action: pending > 0 ? "ACADEMIC_YEAR_CLOSED_WITH_PENDING" : "ACADEMIC_YEAR_CLOSED",
    entityType: "academic_year",
    entityId: year.id,
    metadata: {
      label: year.label,
      pendingCount: pending,
      reason: pending > 0 ? reason : undefined,
    },
  });
  return closed;
}

export async function closeAcademicYear(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  yearId: string,
  override: CloseOverride,
): Promise<AcademicYearRow> {
  const year = await prisma.academicYear.findFirst({ where: { id: yearId, schoolId } });
  if (!year) throw notFound();
  if (year.status !== "ACTIVE") {
    throw badRequest("Only the active academic year can be closed.");
  }
  return prisma.$transaction(async (tx) => closeYearRow(tx as unknown as PrismaClient, auth, year, override));
}

export async function activateAcademicYear(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  yearId: string,
  override: CloseOverride,
): Promise<{ year: AcademicYearRow; closedYear: AcademicYearRow | null }> {
  const planned = await prisma.academicYear.findFirst({ where: { id: yearId, schoolId } });
  if (!planned) throw notFound();
  if (planned.status !== "PLANNED") {
    throw badRequest("Only a planned academic year can be activated.");
  }
  return prisma.$transaction(async (tx) => {
    const client = tx as unknown as PrismaClient;
    const current = await client.academicYear.findFirst({ where: { schoolId, status: "ACTIVE" } });
    const closedYear = current ? await closeYearRow(client, auth, current, override) : null;
    const year = await client.academicYear.update({
      where: { id: planned.id },
      data: { status: "ACTIVE" },
    });
    await writeAudit(client, {
      schoolId,
      actorStaffId: auth.id,
      action: "ACADEMIC_YEAR_ACTIVATED",
      entityType: "academic_year",
      entityId: year.id,
      metadata: { label: year.label, closedYearId: closedYear?.id ?? null },
    });
    return { year, closedYear };
  });
}

export async function parentVisibleEnrollment(
  prisma: PrismaClient,
  schoolId: string,
  enrollment: EnrollmentRow | null,
): Promise<{
  id: string;
  academicYearId: string;
  sectionId: string;
  outcome: EnrollmentRow["outcome"] | null;
  inSummerSession: boolean;
} | null> {
  if (!enrollment) return null;
  const final = enrollment.outcome !== "PENDING";
  const summerCount = final
    ? 0
    : await prisma.period.count({
        where: { schoolId, academicYearId: enrollment.academicYearId, type: "SUMMER" },
      });
  return {
    id: enrollment.id,
    academicYearId: enrollment.academicYearId,
    sectionId: enrollment.sectionId,
    outcome: final ? enrollment.outcome : null,
    inSummerSession: !final && summerCount > 0,
  };
}
