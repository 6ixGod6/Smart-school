import type { PrismaClient } from "@smart-school/shared";
import { badRequest, notFound } from "../http.ts";

const CADENCE = new Set(["CONTINUOUS", "END_OF_PERIOD"]);
const TIMING = new Set(["IMMEDIATE", "GRACE_WINDOW"]);

type SchoolSettings = {
  id: string;
  gradeCadence: "CONTINUOUS" | "END_OF_PERIOD";
  publishTiming: "IMMEDIATE" | "GRACE_WINDOW";
  publishGraceHours: number;
  attendanceVisibleToParents: boolean;
  attendanceCountsTowardGrade: boolean;
};

export async function getSchoolSettings(prisma: PrismaClient, schoolId: string): Promise<SchoolSettings> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      gradeCadence: true,
      publishTiming: true,
      publishGraceHours: true,
      attendanceVisibleToParents: true,
      attendanceCountsTowardGrade: true,
    },
  });
  if (!school) throw notFound();
  return school;
}

export async function updateSchoolSettings(
  prisma: PrismaClient,
  schoolId: string,
  input: {
    gradeCadence?: string;
    publishTiming?: string;
    publishGraceHours?: number;
    attendanceVisibleToParents?: boolean;
    attendanceCountsTowardGrade?: boolean;
  },
): Promise<SchoolSettings> {
  if (Object.keys(input).length === 0) {
    throw badRequest("No settings to update.");
  }
  if (input.gradeCadence !== undefined && !CADENCE.has(input.gradeCadence)) {
    throw badRequest("gradeCadence must be CONTINUOUS or END_OF_PERIOD.");
  }
  if (input.publishTiming !== undefined && !TIMING.has(input.publishTiming)) {
    throw badRequest("publishTiming must be IMMEDIATE or GRACE_WINDOW.");
  }
  if (input.publishGraceHours !== undefined && (input.publishGraceHours < 0 || input.publishGraceHours > 336)) {
    throw badRequest("publishGraceHours must be between 0 and 336.");
  }
  await getSchoolSettings(prisma, schoolId);
  return prisma.school.update({
    where: { id: schoolId },
    data: {
      ...(input.gradeCadence !== undefined
        ? { gradeCadence: input.gradeCadence as "CONTINUOUS" | "END_OF_PERIOD" }
        : {}),
      ...(input.publishTiming !== undefined
        ? { publishTiming: input.publishTiming as "IMMEDIATE" | "GRACE_WINDOW" }
        : {}),
      ...(input.publishGraceHours !== undefined ? { publishGraceHours: input.publishGraceHours } : {}),
      ...(input.attendanceVisibleToParents !== undefined
        ? { attendanceVisibleToParents: input.attendanceVisibleToParents }
        : {}),
      ...(input.attendanceCountsTowardGrade !== undefined
        ? { attendanceCountsTowardGrade: input.attendanceCountsTowardGrade }
        : {}),
    },
    select: {
      id: true,
      gradeCadence: true,
      publishTiming: true,
      publishGraceHours: true,
      attendanceVisibleToParents: true,
      attendanceCountsTowardGrade: true,
    },
  });
}
