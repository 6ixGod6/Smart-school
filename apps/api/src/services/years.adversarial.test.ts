import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  PASSWORD_A,
  PASSWORD_TEACHER,
  PIN_A,
  bearer,
  createHarness,
  expectStatus,
  type Harness,
} from "../test/helpers.ts";

function errorCodes(err: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = err;
  for (let i = 0; i < 8 && current; i += 1) {
    if (typeof current === "object" && current && "code" in current) {
      codes.push(String((current as { code: unknown }).code));
    }
    if (typeof current === "object" && current && "meta" in current) {
      const meta = (current as { meta?: unknown }).meta;
      if (typeof meta === "object" && meta && meta && "code" in meta) {
        codes.push(String((meta as { code: unknown }).code));
      }
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

function expectDbReject(err: unknown, allowed: string[], label: string): void {
  const found = errorCodes(err);
  if (!found.some((code) => allowed.includes(code))) {
    throw new Error(
      `${label}: expected one of ${allowed.join(", ")}, got ${found.join(", ") || "none"}. ${String(err)}`,
    );
  }
}

describe("academic years and enrollments", () => {
  let h: Harness;
  let adminAToken: string;
  let teacherToken: string;
  let parentAToken: string;
  let yearTwoId: string;

  beforeAll(async () => {
    h = await createHarness();
    const adminA = await request(h.app)
      .post("/v1/auth/staff/login")
      .send({ email: "admin.a@school.test", password: PASSWORD_A });
    expectStatus(adminA, 200, "admin A login");
    adminAToken = adminA.body.accessToken;

    const teacher = await request(h.app)
      .post("/v1/auth/staff/login")
      .send({ email: "teacher.a@school.test", password: PASSWORD_TEACHER });
    expectStatus(teacher, 200, "teacher login");
    teacherToken = teacher.body.accessToken;

    const parent = await request(h.app)
      .post("/v1/auth/parent/login")
      .send({ phone: "+231770000001", pin: PIN_A });
    expectStatus(parent, 200, "parent A login");
    parentAToken = parent.body.accessToken;

    const yearTwo = await h.prisma.academicYear.create({
      data: {
        schoolId: h.ids.schoolA,
        label: "2027/2028",
        startDate: new Date("2027-08-01T00:00:00.000Z"),
        endDate: new Date("2028-07-31T00:00:00.000Z"),
        status: "PLANNED",
      },
    });
    yearTwoId = yearTwo.id;
  });

  afterAll(async () => {
    await h.prisma.$disconnect();
  });

  it("lists the school's academic years and hides them from a parent", async () => {
    const ok = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/academic-years`)
      .set(bearer(adminAToken));
    expectStatus(ok, 200, "admin academic years");
    const labels = (ok.body.academicYears as Array<{ label: string; status: string }>).map((row) => row.label);
    expect(labels).toContain("2026/2027");
    expect(labels).toContain("2027/2028");
    expect(ok.body.academicYears.some((row: { status: string }) => row.status === "ACTIVE")).toBe(true);

    const parent = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/academic-years`)
      .set(bearer(parentAToken));
    expectStatus(parent, 403, "parent academic years");
  });

  it("rejects a second enrollment for the same student in the same academic year", async () => {
    try {
      await h.prisma.enrollment.create({
        data: {
          schoolId: h.ids.schoolA,
          studentId: h.ids.studentAssigned,
          academicYearId: h.ids.yearA,
          sectionId: h.ids.sectionOther,
          outcome: "PENDING",
        },
      });
      throw new Error("database accepted two enrollments in one year");
    } catch (err) {
      if (err instanceof Error && err.message === "database accepted two enrollments in one year") throw err;
      expectDbReject(err, ["P2002", "23505"], "duplicate enrollment same year");
    }
  });

  it("allows the same student in the same grade across two years (repeat) without changing studentCode", async () => {
    const before = await h.prisma.student.findUniqueOrThrow({ where: { id: h.ids.studentAssigned } });
    const enrollment = await h.prisma.enrollment.create({
      data: {
        schoolId: h.ids.schoolA,
        studentId: h.ids.studentAssigned,
        academicYearId: yearTwoId,
        sectionId: h.ids.sectionAssigned,
        outcome: "PENDING",
      },
    });
    expect(enrollment.sectionId).toBe(h.ids.sectionAssigned);
    const after = await h.prisma.student.findUniqueOrThrow({ where: { id: h.ids.studentAssigned } });
    expect(after.studentCode).toBe(before.studentCode);
    expect(after.studentCode).toBe("RIC-26-0001");
  });

  it("rejects a second ACTIVE academic year at the same school", async () => {
    try {
      await h.prisma.academicYear.create({
        data: {
          schoolId: h.ids.schoolA,
          label: "2028/2029",
          startDate: new Date("2028-08-01T00:00:00.000Z"),
          endDate: new Date("2029-07-31T00:00:00.000Z"),
          status: "ACTIVE",
        },
      });
      throw new Error("database accepted a second ACTIVE year");
    } catch (err) {
      if (err instanceof Error && err.message === "database accepted a second ACTIVE year") throw err;
      expectDbReject(err, ["P2002", "23505"], "second ACTIVE year");
    }
  });

  it("rejects overlapping academic-year dates at the same school", async () => {
    try {
      await h.prisma.academicYear.create({
        data: {
          schoolId: h.ids.schoolA,
          label: "overlap-year",
          startDate: new Date("2026-09-01T00:00:00.000Z"),
          endDate: new Date("2027-01-15T00:00:00.000Z"),
          status: "PLANNED",
        },
      });
      throw new Error("database accepted overlapping academic years");
    } catch (err) {
      if (err instanceof Error && err.message === "database accepted overlapping academic years") throw err;
      expectDbReject(err, ["23P01", "P2010", "P2039", "23514"], "overlapping academic years");
    }
  });

  it("rejects a SUMMER period that counts toward the grade tally on create and update", async () => {
    const create = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(adminAToken))
      .send({
        number: 1,
        type: "SUMMER",
        academicYearId: h.ids.yearA,
        startDate: "2027-06-01",
        endDate: "2027-06-30",
        gradeEntryDeadline: "2027-07-02T12:00:00.000Z",
        attendanceCountsTowardGrade: true,
      });
    expectStatus(create, 400, "summer counts toward grade");
    expect(create.body.error.message).toMatch(/cannot count toward the grade tally/i);

    const ok = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(adminAToken))
      .send({
        number: 1,
        type: "SUMMER",
        academicYearId: h.ids.yearA,
        startDate: "2027-06-01",
        endDate: "2027-06-30",
        gradeEntryDeadline: "2027-07-02T12:00:00.000Z",
      });
    expectStatus(ok, 201, "create summer period");
    expect(ok.body.period.type).toBe("SUMMER");
    expect(ok.body.period.semester).toBeNull();
    expect(ok.body.period.attendanceCountsTowardGrade).toBe(false);

    const patch = await request(h.app)
      .patch(`/v1/schools/${h.ids.schoolA}/periods/${ok.body.period.id}`)
      .set(bearer(adminAToken))
      .send({ attendanceCountsTowardGrade: true });
    expectStatus(patch, 400, "patch summer counts toward grade");
    expect(patch.body.error.message).toMatch(/cannot count toward the grade tally/i);
  });

  it("rejects two periods that overlap across different academic years", async () => {
    const regular = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(adminAToken))
      .send({
        number: 1,
        type: "REGULAR",
        academicYearId: h.ids.yearA,
        startDate: "2026-09-01",
        endDate: "2026-10-31",
        gradeEntryDeadline: "2026-11-02T12:00:00.000Z",
      });
    expectStatus(regular, 201, "create regular period in year 1");

    const overlap = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(adminAToken))
      .send({
        number: 1,
        type: "REGULAR",
        academicYearId: yearTwoId,
        startDate: "2026-10-15",
        endDate: "2026-11-15",
        gradeEntryDeadline: "2026-11-17T12:00:00.000Z",
      });
    expectStatus(overlap, 409, "cross-year period overlap");
    expect(overlap.body.error.code).toBe("PERIOD_OVERLAP");
  });

  it("still scopes a teacher to assigned sections via the active-year enrollment roster", async () => {
    const assigned = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/sections/${h.ids.sectionAssigned}/students`)
      .set(bearer(teacherToken));
    expectStatus(assigned, 200, "teacher assigned roster");
    const ids = (assigned.body.students as Array<{ id: string; sectionId: string }>).map((row) => row.id);
    expect(ids).toContain(h.ids.studentAssigned);
    expect(ids).not.toContain(h.ids.studentOtherSection);
    expect(assigned.body.students.every((row: { sectionId: string }) => row.sectionId === h.ids.sectionAssigned)).toBe(
      true,
    );

    const student = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}`)
      .set(bearer(teacherToken));
    expectStatus(student, 200, "teacher assigned student via enrollment");
    expect(student.body.student.sectionId).toBe(h.ids.sectionAssigned);

    const other = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/sections/${h.ids.sectionOther}/students`)
      .set(bearer(teacherToken));
    expectStatus(other, 403, "teacher unassigned roster");
  });
});
