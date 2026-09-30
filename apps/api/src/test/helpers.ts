import { createPrisma, type PrismaClient } from "@smart-school/shared";
import request from "supertest";
import { createApp } from "../app.ts";
import { loadConfig, type AppConfig } from "../config.ts";
import { hashSecret } from "../auth/passwords.ts";

export const PASSWORD_A = "SchoolA-admin-pass-1";
export const PASSWORD_TEACHER = "SchoolA-teacher-pass-1";
export const PASSWORD_B = "SchoolB-admin-pass-1";
export const PASSWORD_SUPER = "Platform-super-pass-1";
export const PIN_A = "246801";
export const PIN_B = "135790";
export const PIN_SHARED = "112233";

export type Harness = {
  prisma: PrismaClient;
  config: AppConfig;
  app: ReturnType<typeof createApp>;
  ids: {
    schoolA: string;
    schoolB: string;
    adminA: string;
    teacherA: string;
    adminB: string;
    superAdmin: string;
    parentA: string;
    parentB: string;
    parentSharedA: string;
    parentSharedB: string;
    sectionAssigned: string;
    sectionOther: string;
    studentAssigned: string;
    studentOtherSection: string;
    studentWithdrawn: string;
    studentB: string;
    subjectLit: string;
  };
};

const TABLES = [
  "refresh_tokens",
  "audit_logs",
  "payment_charge_items",
  "receipts",
  "payments",
  "fee_charge_items",
  "charge_batches",
  "event_participations",
  "events",
  "audience_snapshot_members",
  "audiences",
  "notifications",
  "push_subscriptions",
  "grade_entries",
  "attendance_records",
  "parent_student_links",
  "subject_assignments",
  "grade_level_subjects",
  "grade_group_grade_levels",
  "grade_groups",
  "students",
  "parents",
  "staff_users",
  "sections",
  "subjects",
  "periods",
  "grade_levels",
  "schools",
];

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.join(", ")} CASCADE`);
}

export async function createHarness(): Promise<Harness> {
  const config = loadConfig(process.env);
  const prisma = createPrisma(config.databaseUrl);
  await resetDb(prisma);

  const passwordA = await hashSecret(PASSWORD_A, config.bcryptRounds);
  const passwordTeacher = await hashSecret(PASSWORD_TEACHER, config.bcryptRounds);
  const passwordB = await hashSecret(PASSWORD_B, config.bcryptRounds);
  const passwordSuper = await hashSecret(PASSWORD_SUPER, config.bcryptRounds);
  const pinA = await hashSecret(PIN_A, config.bcryptRounds);
  const pinB = await hashSecret(PIN_B, config.bcryptRounds);
  const pinShared = await hashSecret(PIN_SHARED, config.bcryptRounds);

  const schoolA = await prisma.school.create({ data: { name: "Richardsville", idPrefix: "RIC" } });
  const schoolB = await prisma.school.create({ data: { name: "Bomi Academy", idPrefix: "BOM" } });

  const gradeA = await prisma.gradeLevel.create({
    data: { schoolId: schoolA.id, name: "1st Grade", order: 1 },
  });
  const sectionAssigned = await prisma.section.create({
    data: { schoolId: schoolA.id, gradeLevelId: gradeA.id, name: "1st Grade A" },
  });
  const sectionOther = await prisma.section.create({
    data: { schoolId: schoolA.id, gradeLevelId: gradeA.id, name: "1st Grade B" },
  });
  const subjectLit = await prisma.subject.create({
    data: { schoolId: schoolA.id, name: "Literature", nameNormalized: "literature", displayOrder: 1 },
  });

  const adminA = await prisma.staffUser.create({
    data: {
      schoolId: schoolA.id,
      email: "admin.a@school.test",
      username: "admin.a",
      passwordHash: passwordA,
      role: "SCHOOL_ADMIN",
    },
  });
  const teacherA = await prisma.staffUser.create({
    data: {
      schoolId: schoolA.id,
      email: "teacher.a@school.test",
      username: "teacher.a",
      passwordHash: passwordTeacher,
      role: "TEACHER",
    },
  });
  await prisma.subjectAssignment.create({
    data: {
      schoolId: schoolA.id,
      teacherId: teacherA.id,
      subjectId: subjectLit.id,
      sectionId: sectionAssigned.id,
    },
  });
  const adminB = await prisma.staffUser.create({
    data: {
      schoolId: schoolB.id,
      email: "admin.b@school.test",
      passwordHash: passwordB,
      role: "SCHOOL_ADMIN",
    },
  });
  const superAdmin = await prisma.staffUser.create({
    data: {
      schoolId: null,
      email: "super@platform.test",
      passwordHash: passwordSuper,
      role: "SUPER_ADMIN",
    },
  });

  const studentAssigned = await prisma.student.create({
    data: {
      schoolId: schoolA.id,
      sectionId: sectionAssigned.id,
      studentCode: "RIC-26-0001",
      name: "Amina Kollie",
      status: "ACTIVE",
    },
  });
  const studentOtherSection = await prisma.student.create({
    data: {
      schoolId: schoolA.id,
      sectionId: sectionOther.id,
      studentCode: "RIC-26-0002",
      name: "James Doe",
      status: "ACTIVE",
    },
  });
  const studentWithdrawn = await prisma.student.create({
    data: {
      schoolId: schoolA.id,
      sectionId: sectionAssigned.id,
      studentCode: "RIC-26-0003",
      name: "Withdrawn Child",
      status: "WITHDRAWN",
    },
  });
  const gradeB = await prisma.gradeLevel.create({
    data: { schoolId: schoolB.id, name: "1st Grade", order: 1 },
  });
  const sectionB = await prisma.section.create({
    data: { schoolId: schoolB.id, gradeLevelId: gradeB.id, name: "1st Grade A" },
  });
  const studentB = await prisma.student.create({
    data: {
      schoolId: schoolB.id,
      sectionId: sectionB.id,
      studentCode: "BOM-26-0001",
      name: "School B Student",
      status: "ACTIVE",
    },
  });

  const parentA = await prisma.parent.create({
    data: { schoolId: schoolA.id, phone: "+231770000001", pinHash: pinA, mustChangePin: true },
  });
  await prisma.parentStudentLink.create({
    data: {
      parentId: parentA.id,
      studentId: studentAssigned.id,
      schoolId: schoolA.id,
      relationship: "mother",
    },
  });
  await prisma.parentStudentLink.create({
    data: {
      parentId: parentA.id,
      studentId: studentWithdrawn.id,
      schoolId: schoolA.id,
      relationship: "mother",
    },
  });
  const parentB = await prisma.parent.create({
    data: { schoolId: schoolB.id, phone: "+231770000002", pinHash: pinB, mustChangePin: false },
  });
  await prisma.parentStudentLink.create({
    data: {
      parentId: parentB.id,
      studentId: studentB.id,
      schoolId: schoolB.id,
      relationship: "father",
    },
  });

  const parentSharedA = await prisma.parent.create({
    data: { schoolId: schoolA.id, phone: "+231770000099", pinHash: pinShared, mustChangePin: false },
  });
  const parentSharedB = await prisma.parent.create({
    data: { schoolId: schoolB.id, phone: "+231770000099", pinHash: pinShared, mustChangePin: false },
  });

  const app = createApp({ prisma, config });
  return {
    prisma,
    config,
    app,
    ids: {
      schoolA: schoolA.id,
      schoolB: schoolB.id,
      adminA: adminA.id,
      teacherA: teacherA.id,
      adminB: adminB.id,
      superAdmin: superAdmin.id,
      parentA: parentA.id,
      parentB: parentB.id,
      parentSharedA: parentSharedA.id,
      parentSharedB: parentSharedB.id,
      sectionAssigned: sectionAssigned.id,
      sectionOther: sectionOther.id,
      studentAssigned: studentAssigned.id,
      studentOtherSection: studentOtherSection.id,
      studentWithdrawn: studentWithdrawn.id,
      studentB: studentB.id,
      subjectLit: subjectLit.id,
    },
  };
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function expectStatus(res: request.Response, status: number, label: string): void {
  if (res.status !== status) {
    throw new Error(
      `${label}: expected HTTP ${status}, got ${res.status}. Body: ${JSON.stringify(res.body)}`,
    );
  }
}
