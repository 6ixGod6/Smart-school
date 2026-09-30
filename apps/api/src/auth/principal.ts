import type { AuthPrincipal, PrismaClient, Role } from "@smart-school/shared";
import type { AppConfig } from "../config.ts";

export type AppDeps = {
  prisma: PrismaClient;
  config: AppConfig;
};

export function staffRoleToClaim(role: "TEACHER" | "SCHOOL_ADMIN" | "SUPER_ADMIN"): Role {
  switch (role) {
    case "TEACHER":
      return "teacher";
    case "SCHOOL_ADMIN":
      return "school_admin";
    case "SUPER_ADMIN":
      return "super_admin";
  }
}

export async function loadStaffPrincipal(prisma: PrismaClient, staffId: string): Promise<AuthPrincipal | null> {
  const staff = await prisma.staffUser.findUnique({
    where: { id: staffId },
    include: { assignments: { select: { sectionId: true, subjectId: true } } },
  });
  if (!staff || !staff.isActive) return null;
  const sectionIds = [...new Set(staff.assignments.map((row) => row.sectionId))];
  const subjectIds = [...new Set(staff.assignments.map((row) => row.subjectId))];
  return {
    id: staff.id,
    role: staffRoleToClaim(staff.role),
    kind: "staff",
    schoolId: staff.schoolId,
    email: staff.email,
    sectionIds,
    subjectIds,
    studentIds: [],
  };
}

export async function loadParentPrincipal(prisma: PrismaClient, parentId: string): Promise<AuthPrincipal | null> {
  const parent = await prisma.parent.findUnique({
    where: { id: parentId },
    include: { links: { select: { studentId: true } } },
  });
  if (!parent) return null;
  return {
    id: parent.id,
    role: "parent",
    kind: "parent",
    schoolId: parent.schoolId,
    phone: parent.phone,
    mustChangePin: parent.mustChangePin,
    sectionIds: [],
    subjectIds: [],
    studentIds: parent.links.map((link) => link.studentId),
  };
}
