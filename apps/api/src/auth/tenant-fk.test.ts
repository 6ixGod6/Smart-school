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

  it("rejects a student whose schoolId does not match the section's school", async () => {
    try {
      await h.prisma.student.create({
        data: {
          schoolId: h.ids.schoolA,
          sectionId: h.ids.sectionB,
          studentCode: "RIC-26-9999",
          name: "Cross-tenant student",
          status: "ACTIVE",
        },
      });
      throw new Error("database accepted a cross-tenant student");
    } catch (err) {
      if (err instanceof Error && err.message === "database accepted a cross-tenant student") throw err;
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
