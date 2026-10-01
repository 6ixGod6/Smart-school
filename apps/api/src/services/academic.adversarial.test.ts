import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  PASSWORD_A,
  PASSWORD_B,
  PASSWORD_TEACHER,
  PIN_A,
  bearer,
  createHarness,
  expectStatus,
  type Harness,
} from "../test/helpers.ts";

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addUtcDays(base: Date, days: number): string {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

describe("periods, attendance, and school settings", () => {
  let h: Harness;
  let adminAToken: string;
  let adminBToken: string;
  let teacherToken: string;
  let parentAToken: string;
  let closedMark: string;
  let openMark: string;

  beforeAll(async () => {
    h = await createHarness();
    const adminA = await request(h.app)
      .post("/v1/auth/staff/login")
      .send({ email: "admin.a@school.test", password: PASSWORD_A });
    expectStatus(adminA, 200, "admin A login");
    adminAToken = adminA.body.accessToken;

    const adminB = await request(h.app)
      .post("/v1/auth/staff/login")
      .send({ email: "admin.b@school.test", password: PASSWORD_B });
    expectStatus(adminB, 200, "admin B login");
    adminBToken = adminB.body.accessToken;

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

    const today = utcToday();
    closedMark = addUtcDays(today, -45);
    openMark = addUtcDays(today, 0);

    const closed = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(adminAToken))
      .send({
        number: 1,
        name: "Period 1",
        startDate: addUtcDays(today, -60),
        endDate: addUtcDays(today, -30),
        gradeEntryDeadline: `${addUtcDays(today, -28)}T12:00:00.000Z`,
      });
    expectStatus(closed, 201, "create closed period");
    expect(closed.body.period.semester).toBe("FIRST");

    const open = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(adminAToken))
      .send({
        number: 2,
        name: "Period 2",
        startDate: addUtcDays(today, -5),
        endDate: addUtcDays(today, 60),
        gradeEntryDeadline: `${addUtcDays(today, 62)}T12:00:00.000Z`,
      });
    expectStatus(open, 201, "create open period");
  });

  afterAll(async () => {
    await h.prisma.$disconnect();
  });

  it("rejects a teacher creating a period", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(teacherToken))
      .send({
        number: 3,
        startDate: "2027-01-01",
        endDate: "2027-02-01",
        gradeEntryDeadline: "2027-02-03T12:00:00.000Z",
      });
    expectStatus(res, 403, "teacher creating period");
  });

  it("rejects overlapping periods and endDate on or before startDate", async () => {
    const overlap = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(adminAToken))
      .send({
        number: 3,
        startDate: openMark,
        endDate: addUtcDays(utcToday(), 10),
        gradeEntryDeadline: `${addUtcDays(utcToday(), 12)}T12:00:00.000Z`,
      });
    expectStatus(overlap, 409, "overlapping period");
    expect(overlap.body.error.code).toBe("PERIOD_OVERLAP");

    const inverted = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(adminAToken))
      .send({
        number: 4,
        startDate: "2027-03-10",
        endDate: "2027-03-01",
        gradeEntryDeadline: "2027-03-12T12:00:00.000Z",
      });
    expectStatus(inverted, 400, "end before start");
  });

  it("lets a teacher mark attendance for an assigned section and records who marked it", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/sections/${h.ids.sectionAssigned}/attendance`)
      .set(bearer(teacherToken))
      .send({
        date: openMark,
        records: [{ studentId: h.ids.studentAssigned, status: "PRESENT" }],
      });
    expectStatus(res, 200, "teacher mark assigned section");
    expect(res.body.records[0].status).toBe("PRESENT");
    expect(res.body.records[0].recordedByStaffId).toBe(h.ids.teacherA);
  });

  it("rejects a teacher marking attendance for a section they are not assigned to", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/sections/${h.ids.sectionOther}/attendance`)
      .set(bearer(teacherToken))
      .send({
        date: openMark,
        records: [{ studentId: h.ids.studentOtherSection, status: "ABSENT" }],
      });
    expectStatus(res, 403, "teacher unassigned section attendance");
  });

  it("rejects a teacher writing attendance into a closed period", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/sections/${h.ids.sectionAssigned}/attendance`)
      .set(bearer(teacherToken))
      .send({
        date: closedMark,
        records: [{ studentId: h.ids.studentAssigned, status: "LATE" }],
      });
    expectStatus(res, 403, "teacher closed period");
  });

  it("rejects an admin amending a closed period without a reason", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/sections/${h.ids.sectionAssigned}/attendance`)
      .set(bearer(adminAToken))
      .send({
        date: closedMark,
        records: [{ studentId: h.ids.studentAssigned, status: "ABSENT" }],
      });
    expectStatus(res, 400, "admin closed period without reason");
  });

  it("lets an admin amend a closed period with a reason and writes an audit row", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/sections/${h.ids.sectionAssigned}/attendance`)
      .set(bearer(adminAToken))
      .send({
        date: closedMark,
        records: [{ studentId: h.ids.studentAssigned, status: "ABSENT" }],
        reason: "Correcting a late slip from the office.",
      });
    expectStatus(res, 200, "admin closed period with reason");
    expect(res.body.records[0].status).toBe("ABSENT");

    const audit = await h.prisma.auditLog.findFirst({
      where: { action: "ATTENDANCE_CLOSED_PERIOD_AMENDED", schoolId: h.ids.schoolA },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
    expect(audit?.actorStaffId).toBe(h.ids.adminA);
    const metadata = audit?.metadata as {
      studentId: string;
      oldStatus: string | null;
      newStatus: string;
      reason: string;
    };
    expect(metadata.studentId).toBe(h.ids.studentAssigned);
    expect(metadata.newStatus).toBe("ABSENT");
    expect(metadata.reason).toContain("Correcting");
  });

  it("rejects a School A user touching School B attendance", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolB}/sections/${h.ids.sectionB}/attendance`)
      .set(bearer(adminAToken))
      .send({
        date: openMark,
        records: [{ studentId: h.ids.studentB, status: "PRESENT" }],
      });
    expectStatus(res, 403, "school A admin marking school B attendance");
  });

  it("rejects a parent attempting any attendance write", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/sections/${h.ids.sectionAssigned}/attendance`)
      .set(bearer(parentAToken))
      .send({
        date: openMark,
        records: [{ studentId: h.ids.studentAssigned, status: "PRESENT" }],
      });
    expectStatus(res, 403, "parent attendance write");
  });

  it("lets a parent read their child's attendance when the school setting allows it", async () => {
    const res = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}/attendance`)
      .set(bearer(parentAToken));
    expectStatus(res, 200, "parent attendance visible");
    expect(res.body.records.length).toBeGreaterThan(0);
  });

  it("rejects a parent reading attendance when attendanceVisibleToParents is false", async () => {
    const patched = await request(h.app)
      .patch(`/v1/schools/${h.ids.schoolA}/settings`)
      .set(bearer(adminAToken))
      .send({ attendanceVisibleToParents: false });
    expectStatus(patched, 200, "hide attendance from parents");
    expect(patched.body.settings.attendanceVisibleToParents).toBe(false);

    const res = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}/attendance`)
      .set(bearer(parentAToken));
    expectStatus(res, 403, "parent attendance hidden");

    const teacherRead = await request(h.app)
      .get(
        `/v1/schools/${h.ids.schoolA}/sections/${h.ids.sectionAssigned}/attendance?date=${openMark}`,
      )
      .set(bearer(teacherToken));
    expectStatus(teacherRead, 200, "teacher still reads assigned section");

    const restore = await request(h.app)
      .patch(`/v1/schools/${h.ids.schoolA}/settings`)
      .set(bearer(adminAToken))
      .send({ attendanceVisibleToParents: true });
    expectStatus(restore, 200, "restore attendance visibility");
  });

  it("rejects a teacher reading school settings", async () => {
    const res = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/settings`)
      .set(bearer(teacherToken));
    expectStatus(res, 403, "teacher reading settings");
  });

  it("rejects a School B admin reading School A settings", async () => {
    const res = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/settings`)
      .set(bearer(adminBToken));
    expectStatus(res, 403, "cross-school settings");
  });
});
