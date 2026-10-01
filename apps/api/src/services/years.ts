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
