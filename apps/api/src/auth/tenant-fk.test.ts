import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@smart-school/shared";
import { createHarness, type Harness } from "../test/helpers.ts";

function constraintCode(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code;
  if (typeof err === "object" && err && "code" in err) return String((err as { code: string }).code);
  return "";
}

describe("tenant composite foreign keys", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.prisma.$disconnect();
  });

  it("rejects an enrollment whose section belongs to another school", async () => {
    const student = await h.prisma.student.create({
      data: {
        schoolId: h.ids.schoolA,
        studentCode: "RIC-26-9999",
        name: "Cross-tenant student",
        status: "ACTIVE",
      },
    });
    try {
      await h.prisma.enrollment.create({
        data: {
          schoolId: h.ids.schoolA,
          studentId: student.id,
          academicYearId: h.ids.yearA,
          sectionId: h.ids.sectionB,
          outcome: "PENDING",
        },
      });
      throw new Error("database accepted a cross-tenant enrollment");
    } catch (err) {
      if (err instanceof Error && err.message === "database accepted a cross-tenant enrollment") throw err;
      expect(["P2003", "23503"]).toContain(constraintCode(err));
    }
  });

  it("rejects an enrollment that points at another school's year", async () => {
    try {
      await h.prisma.enrollment.create({
        data: {
          schoolId: h.ids.schoolA,
          studentId: h.ids.studentAssigned,
          academicYearId: h.ids.yearB,
          sectionId: h.ids.sectionAssigned,
          outcome: "PENDING",
        },
      });
      throw new Error("database accepted a cross-tenant year on enrollment");
    } catch (err) {
      if (err instanceof Error && err.message === "database accepted a cross-tenant year on enrollment") throw err;
      expect(["P2003", "23503"]).toContain(constraintCode(err));
    }
  });

  it("rejects a parent–student link that points at a child in another school", async () => {
    try {
      await h.prisma.parentStudentLink.create({
        data: {
          schoolId: h.ids.schoolA,
          parentId: h.ids.parentA,
          studentId: h.ids.studentB,
          relationship: "guardian",
        },
      });
      throw new Error("database accepted a cross-tenant parent-student link");
    } catch (err) {
      if (err instanceof Error && err.message === "database accepted a cross-tenant parent-student link") throw err;
      expect(["P2003", "23503"]).toContain(constraintCode(err));
    }
  });
});
