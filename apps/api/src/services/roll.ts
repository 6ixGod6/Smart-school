import type { PrismaClient } from "@smart-school/shared";

/** On the roll (billable / expected back). WITHDRAWN and GRADUATED are off-roll. */
export const ON_ROLL_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export function isOnRollStatus(status: string): boolean {
  return status === "ACTIVE" || status === "INACTIVE";
}

/** Enrollment count that would be billed: excludes withdrawn, transferred, and graduated. */
export async function countOnRollEnrollments(
  prisma: PrismaClient,
  schoolId: string,
  academicYearId: string,
): Promise<number> {
  return prisma.enrollment.count({
    where: {
      schoolId,
      academicYearId,
      student: { status: { in: [...ON_ROLL_STATUSES] } },
    },
  });
}
