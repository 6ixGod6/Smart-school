import type { PrismaClient } from "@smart-school/shared";
import { badRequest, conflict, notFound } from "../http.ts";
import { dateOnlyString, parseDateOnly } from "../dates.ts";
import { requireActiveYear } from "./years.ts";

type PeriodRow = {
  id: string;
  schoolId: string;
  academicYearId: string;
  name: string;
  number: number;
  type: "REGULAR" | "SUMMER";
  semester: "FIRST" | "SECOND" | null;
  startDate: Date;
  endDate: Date;
  gradeEntryDeadline: Date;
  attendanceCountsTowardGrade: boolean | null;
};

function semesterForRegularNumber(number: number): "FIRST" | "SECOND" {
  if (number < 1 || number > 6) {
    throw badRequest("Regular period number must be between 1 and 6.");
  }
  return number <= 3 ? "FIRST" : "SECOND";
}

async function assertNoOverlap(
  prisma: PrismaClient,
  schoolId: string,
  startDate: Date,
  endDate: Date,
  excludeId?: string,
): Promise<void> {
  const clash = await prisma.period.findFirst({
    where: {
      schoolId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
  });
  if (clash) {
    throw conflict(
      "PERIOD_OVERLAP",
      `This date range overlaps period ${clash.number} (${dateOnlyString(clash.startDate)}–${dateOnlyString(clash.endDate)}).`,
    );
  }
}

export async function listPeriods(prisma: PrismaClient, schoolId: string): Promise<PeriodRow[]> {
  return prisma.period.findMany({
    where: { schoolId },
    orderBy: [{ type: "asc" }, { number: "asc" }],
  });
}

export async function createPeriod(
  prisma: PrismaClient,
  schoolId: string,
  input: {
    number: number;
    name?: string;
    startDate: string;
    endDate: string;
    gradeEntryDeadline: string;
    academicYearId?: string;
    type?: string;
    attendanceCountsTowardGrade?: boolean | null;
  },
): Promise<PeriodRow> {
  const type = input.type === "SUMMER" ? "SUMMER" : "REGULAR";
  if (input.type && input.type !== "REGULAR" && input.type !== "SUMMER") {
    throw badRequest("type must be REGULAR or SUMMER.");
  }
  if (type === "REGULAR") {
    semesterForRegularNumber(input.number);
  } else if (input.number < 1 || input.number > 20) {
    throw badRequest("Summer period number must be between 1 and 20.");
  }

  let attendanceCountsTowardGrade: boolean | null = input.attendanceCountsTowardGrade ?? null;
  if (type === "SUMMER") {
    if (attendanceCountsTowardGrade === true) {
      throw badRequest("Summer periods cannot count toward the grade tally.");
    }
    attendanceCountsTowardGrade = false;
  }

  const academicYearId = input.academicYearId ?? (await requireActiveYear(prisma, schoolId)).id;
  const year = await prisma.academicYear.findFirst({ where: { id: academicYearId, schoolId } });
  if (!year) throw notFound();

  const startDate = parseDateOnly(input.startDate, "startDate");
  const endDate = parseDateOnly(input.endDate, "endDate");
  if (endDate <= startDate) {
    throw badRequest("endDate must be after startDate.");
  }
  const gradeEntryDeadline = new Date(input.gradeEntryDeadline);
  if (Number.isNaN(gradeEntryDeadline.getTime())) {
    throw badRequest("gradeEntryDeadline must be an ISO datetime.");
  }
  await assertNoOverlap(prisma, schoolId, startDate, endDate);
  const name = input.name?.trim() || (type === "SUMMER" ? `Summer ${input.number}` : `${input.number}`);
  try {
    return await prisma.period.create({
      data: {
        schoolId,
        academicYearId,
        number: input.number,
        name,
        type,
        semester: type === "REGULAR" ? semesterForRegularNumber(input.number) : null,
        startDate,
        endDate,
        gradeEntryDeadline,
        attendanceCountsTowardGrade,
      },
    });
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "P2002") {
      throw conflict("PERIOD_NUMBER_TAKEN", `Period ${input.number} already exists for this year and type.`);
    }
    throw err;
  }
}

export async function updatePeriod(
  prisma: PrismaClient,
  schoolId: string,
  periodId: string,
  input: {
    name?: string;
    startDate?: string;
    endDate?: string;
    gradeEntryDeadline?: string;
    attendanceCountsTowardGrade?: boolean | null;
  },
): Promise<PeriodRow> {
  const existing = await prisma.period.findFirst({ where: { id: periodId, schoolId } });
  if (!existing) throw notFound();
  const startDate = input.startDate ? parseDateOnly(input.startDate, "startDate") : existing.startDate;
  const endDate = input.endDate ? parseDateOnly(input.endDate, "endDate") : existing.endDate;
  if (endDate <= startDate) {
    throw badRequest("endDate must be after startDate.");
  }
  await assertNoOverlap(prisma, schoolId, startDate, endDate, existing.id);
  const gradeEntryDeadline = input.gradeEntryDeadline
    ? new Date(input.gradeEntryDeadline)
    : existing.gradeEntryDeadline;
  if (Number.isNaN(gradeEntryDeadline.getTime())) {
    throw badRequest("gradeEntryDeadline must be an ISO datetime.");
  }
  let attendanceCountsTowardGrade =
    input.attendanceCountsTowardGrade !== undefined
      ? input.attendanceCountsTowardGrade
      : existing.attendanceCountsTowardGrade;
  if (existing.type === "SUMMER") {
    if (attendanceCountsTowardGrade === true) {
      throw badRequest("Summer periods cannot count toward the grade tally.");
    }
    attendanceCountsTowardGrade = false;
  }
  return prisma.period.update({
    where: { id: existing.id },
    data: {
      name: input.name?.trim() || existing.name,
      startDate,
      endDate,
      gradeEntryDeadline,
      attendanceCountsTowardGrade,
    },
  });
}

export async function periodCoveringDate(
  prisma: PrismaClient,
  schoolId: string,
  date: Date,
): Promise<PeriodRow | null> {
  return prisma.period.findFirst({
    where: { schoolId, startDate: { lte: date }, endDate: { gte: date } },
  });
}

export function periodIsClosed(endDate: Date, today = new Date()): boolean {
  return dateOnlyString(endDate) < dateOnlyString(today);
}
