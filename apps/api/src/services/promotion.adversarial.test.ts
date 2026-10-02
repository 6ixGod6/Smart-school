import { randomUUID } from "node:crypto";
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

describe("year lifecycle and promotion", () => {
  let h: Harness;
  let adminAToken: string;
  let teacherToken: string;
  let parentAToken: string;
  let yearNextId: string;
  let nextSectionId: string;
  let repeaterId: string;
  let repeaterCode: string;

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

    const created = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/academic-years`)
      .set(bearer(adminAToken))
      .send({ label: "2027/2028", startDate: "2027-08-01", endDate: "2028-07-31" });
    expectStatus(created, 201, "create planned year");
    expect(created.body.academicYear.status).toBe("PLANNED");
    yearNextId = created.body.academicYear.id;

    const source = await h.prisma.section.findFirstOrThrow({ where: { id: h.ids.sectionAssigned } });
    const nextGrade = await h.prisma.gradeLevel.create({
      data: { schoolId: h.ids.schoolA, name: "2nd Grade", order: 2 },
    });
    const nextSection = await h.prisma.section.create({
      data: { schoolId: h.ids.schoolA, gradeLevelId: nextGrade.id, name: "2nd Grade A" },
    });
    nextSectionId = nextSection.id;

    const repeater = await h.prisma.student.create({
      data: {
        schoolId: h.ids.schoolA,
        studentCode: "RIC-26-0100",
        name: "Repeating Student",
        status: "ACTIVE",
      },
    });
    repeaterId = repeater.id;
    repeaterCode = repeater.studentCode;
    await h.prisma.enrollment.create({
      data: {
        schoolId: h.ids.schoolA,
        studentId: repeater.id,
        academicYearId: h.ids.yearA,
        sectionId: source.id,
        outcome: "PENDING",
      },
    });

    const summer = await request(h.app)
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
    expectStatus(summer, 201, "summer period on active year");
  });

  afterAll(async () => {
    await h.prisma.$disconnect();
  });

  it("rejects a teacher creating a year or setting an outcome", async () => {
    const year = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/academic-years`)
      .set(bearer(teacherToken))
      .send({ label: "2028/2029", startDate: "2028-08-01", endDate: "2029-07-31" });
    expectStatus(year, 403, "teacher create year");

    const review = await request(h.app)
      .get(
        `/v1/schools/${h.ids.schoolA}/academic-years/${h.ids.yearA}/sections/${h.ids.sectionAssigned}/promotion-review?targetYearId=${yearNextId}`,
      )
      .set(bearer(teacherToken));
    expectStatus(review, 403, "teacher promotion review");

    const promote = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/promotions`)
      .set(bearer(teacherToken))
      .send({
        sourceYearId: h.ids.yearA,
        sourceSectionId: h.ids.sectionAssigned,
        targetYearId: yearNextId,
        defaultTargetSectionId: nextSectionId,
        repeatTargetSectionId: h.ids.sectionOther,
        decisions: [{ studentId: h.ids.studentAssigned, outcome: "PROMOTED" }],
      });
    expectStatus(promote, 403, "teacher set outcome");
  });

  it("hides a PENDING outcome from a parent and shows summer session instead", async () => {
    const res = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}`)
      .set(bearer(parentAToken));
    expectStatus(res, 200, "parent student while pending");
    expect(res.body.student.enrollment.outcome).toBeNull();
    expect(res.body.student.enrollment.inSummerSession).toBe(true);
  });

  it("rejects closing or activating while enrollments are still PENDING", async () => {
    const close = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/academic-years/${h.ids.yearA}/close`)
      .set(bearer(adminAToken))
      .send({});
    expectStatus(close, 409, "close with pending");
    expect(close.body.error.code).toBe("YEAR_HAS_PENDING");
    expect(close.body.error.message).toMatch(/still have no outcome/);

    const activate = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/academic-years/${yearNextId}/activate`)
      .set(bearer(adminAToken))
      .send({});
    expectStatus(activate, 409, "activate while current year pending");
    expect(activate.body.error.code).toBe("YEAR_HAS_PENDING");
  });

  it("returns a promotion review with pending-in-year count and target flags", async () => {
    const res = await request(h.app)
      .get(
        `/v1/schools/${h.ids.schoolA}/academic-years/${h.ids.yearA}/sections/${h.ids.sectionAssigned}/promotion-review?targetYearId=${yearNextId}`,
      )
      .set(bearer(adminAToken));
    expectStatus(res, 200, "promotion review");
    expect(res.body.pendingInYear).toBeGreaterThan(0);
    const assigned = res.body.students.find((row: { id: string }) => row.id === h.ids.studentAssigned);
    expect(assigned.studentCode).toBe("RIC-26-0001");
    expect(assigned.enrollment.outcome).toBe("PENDING");
    expect(assigned.hasTargetEnrollment).toBe(false);
  });

  it("promotes, repeats, and defers in one wave without changing studentCode", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/promotions`)
      .set(bearer(adminAToken))
      .send({
        sourceYearId: h.ids.yearA,
        sourceSectionId: h.ids.sectionAssigned,
        targetYearId: yearNextId,
        defaultTargetSectionId: nextSectionId,
        repeatTargetSectionId: h.ids.sectionOther,
        decisions: [
          { studentId: h.ids.studentAssigned, outcome: "PROMOTED" },
          { studentId: repeaterId, outcome: "REPEATING" },
          { studentId: h.ids.studentWithdrawn, outcome: "PENDING" },
        ],
      });
    expectStatus(res, 200, "first promotion wave");
    expect(res.body.applied).toHaveLength(2);
    expect(res.body.deferred).toEqual([{ studentId: h.ids.studentWithdrawn }]);

    const promoted = await h.prisma.student.findUniqueOrThrow({ where: { id: h.ids.studentAssigned } });
    expect(promoted.studentCode).toBe("RIC-26-0001");
    const repeater = await h.prisma.student.findUniqueOrThrow({ where: { id: repeaterId } });
    expect(repeater.studentCode).toBe(repeaterCode);

    const sourcePromoted = await h.prisma.enrollment.findFirstOrThrow({
      where: { studentId: h.ids.studentAssigned, academicYearId: h.ids.yearA },
    });
    expect(sourcePromoted.outcome).toBe("PROMOTED");
    const nextPromoted = await h.prisma.enrollment.findFirstOrThrow({
      where: { studentId: h.ids.studentAssigned, academicYearId: yearNextId },
    });
    expect(nextPromoted.sectionId).toBe(nextSectionId);
    expect(nextPromoted.outcome).toBe("PENDING");

    const sourceRepeat = await h.prisma.enrollment.findFirstOrThrow({
      where: { studentId: repeaterId, academicYearId: h.ids.yearA },
    });
    const nextRepeat = await h.prisma.enrollment.findFirstOrThrow({
      where: { studentId: repeaterId, academicYearId: yearNextId },
    });
    expect(sourceRepeat.outcome).toBe("REPEATING");
    expect(nextRepeat.sectionId).toBe(h.ids.sectionOther);
    const sourceSection = await h.prisma.section.findFirstOrThrow({ where: { id: h.ids.sectionAssigned } });
    const repeatSection = await h.prisma.section.findFirstOrThrow({ where: { id: nextRepeat.sectionId } });
    expect(repeatSection.gradeLevelId).toBe(sourceSection.gradeLevelId);

    const audit = await h.prisma.auditLog.findFirst({
      where: { action: "ENROLLMENT_OUTCOME_SET", entityId: sourcePromoted.id },
    });
    expect(audit?.actorStaffId).toBe(h.ids.adminA);
    const metadata = audit?.metadata as { oldOutcome: string; newOutcome: string; studentId: string };
    expect(metadata.oldOutcome).toBe("PENDING");
    expect(metadata.newOutcome).toBe("PROMOTED");
    expect(metadata.studentId).toBe(h.ids.studentAssigned);

    const parent = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}`)
      .set(bearer(parentAToken));
    expectStatus(parent, 200, "parent sees final outcome");
    expect(parent.body.student.enrollment.outcome).toBe("PROMOTED");
  });

  it("skips an already-promoted student on a second wave instead of duplicating", async () => {
    const before = await h.prisma.enrollment.count({
      where: { studentId: h.ids.studentAssigned, academicYearId: yearNextId },
    });
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/promotions`)
      .set(bearer(adminAToken))
      .send({
        sourceYearId: h.ids.yearA,
        sourceSectionId: h.ids.sectionAssigned,
        targetYearId: yearNextId,
        defaultTargetSectionId: nextSectionId,
        repeatTargetSectionId: h.ids.sectionOther,
        decisions: [{ studentId: h.ids.studentAssigned, outcome: "PROMOTED" }],
      });
    expectStatus(res, 200, "idempotent re-run");
    expect(res.body.skipped).toEqual([
      { studentId: h.ids.studentAssigned, reason: "already_enrolled_in_target_year" },
    ]);
    const after = await h.prisma.enrollment.count({
      where: { studentId: h.ids.studentAssigned, academicYearId: yearNextId },
    });
    expect(after).toBe(before);
  });

  it("rolls back the whole wave when one student is not in the source section", async () => {
    const before = await h.prisma.enrollment.count({ where: { academicYearId: yearNextId } });
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/promotions`)
      .set(bearer(adminAToken))
      .send({
        sourceYearId: h.ids.yearA,
        sourceSectionId: h.ids.sectionAssigned,
        targetYearId: yearNextId,
        defaultTargetSectionId: nextSectionId,
        repeatTargetSectionId: h.ids.sectionOther,
        decisions: [
          { studentId: h.ids.studentWithdrawn, outcome: "GRADUATED" },
          { studentId: randomUUID(), outcome: "PROMOTED" },
        ],
      });
    expectStatus(res, 400, "mid-batch invalid student");
    const after = await h.prisma.enrollment.count({ where: { academicYearId: yearNextId } });
    expect(after).toBe(before);
    const withdrawn = await h.prisma.enrollment.findFirstOrThrow({
      where: { studentId: h.ids.studentWithdrawn, academicYearId: h.ids.yearA },
    });
    expect(withdrawn.outcome).toBe("PENDING");
  });

  it("rejects a close override without a reason, then closes with a reason and keeps PENDING editable", async () => {
    const noReason = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/academic-years/${h.ids.yearA}/close`)
      .set(bearer(adminAToken))
      .send({ override: true });
    expectStatus(noReason, 400, "override without reason");

    const closed = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/academic-years/${h.ids.yearA}/close`)
      .set(bearer(adminAToken))
      .send({ override: true, reason: "Summer cohort still sitting papers." });
    expectStatus(closed, 200, "close with override");
    expect(closed.body.academicYear.status).toBe("CLOSED");

    const audit = await h.prisma.auditLog.findFirst({
      where: { action: "ACADEMIC_YEAR_CLOSED_WITH_PENDING", entityId: h.ids.yearA },
    });
    expect(audit?.actorStaffId).toBe(h.ids.adminA);
    const metadata = audit?.metadata as { pendingCount: number; reason: string };
    expect(metadata.pendingCount).toBeGreaterThan(0);
    expect(metadata.reason).toContain("Summer cohort");

    const afterClose = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/promotions`)
      .set(bearer(adminAToken))
      .send({
        sourceYearId: h.ids.yearA,
        sourceSectionId: h.ids.sectionAssigned,
        targetYearId: yearNextId,
        defaultTargetSectionId: nextSectionId,
        repeatTargetSectionId: h.ids.sectionOther,
        decisions: [{ studentId: h.ids.studentWithdrawn, outcome: "GRADUATED" }],
      });
    expectStatus(afterClose, 200, "set outcome after year close");
    expect(afterClose.body.applied[0].outcome).toBe("GRADUATED");
    const student = await h.prisma.student.findUniqueOrThrow({ where: { id: h.ids.studentWithdrawn } });
    expect(student.status).toBe("GRADUATED");
    expect(student.studentCode).toBe("RIC-26-0003");
  });

  it("rejects attendance and period writes against a closed year", async () => {
    const mark = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/sections/${h.ids.sectionAssigned}/attendance`)
      .set(bearer(adminAToken))
      .send({
        date: "2027-06-15",
        records: [{ studentId: h.ids.studentAssigned, status: "PRESENT" }],
        reason: "Trying after close.",
      });
    expectStatus(mark, 403, "attendance on closed year");

    const period = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(adminAToken))
      .send({
        number: 2,
        type: "SUMMER",
        academicYearId: h.ids.yearA,
        startDate: "2027-07-01",
        endDate: "2027-07-15",
        gradeEntryDeadline: "2027-07-16T12:00:00.000Z",
      });
    expectStatus(period, 403, "period on closed year");
  });

  it("rejects promoting into another school's section", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/promotions`)
      .set(bearer(adminAToken))
      .send({
        sourceYearId: h.ids.yearA,
        sourceSectionId: h.ids.sectionAssigned,
        targetYearId: yearNextId,
        defaultTargetSectionId: h.ids.sectionB,
        repeatTargetSectionId: h.ids.sectionOther,
        decisions: [{ studentId: h.ids.studentAssigned, outcome: "PROMOTED" }],
      });
    expectStatus(res, 404, "cross-school target section");
  });

  it("activates the planned year after the previous year is closed", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/academic-years/${yearNextId}/activate`)
      .set(bearer(adminAToken))
      .send({});
    expectStatus(res, 200, "activate next year");
    expect(res.body.year.status).toBe("ACTIVE");
    const previous = await h.prisma.academicYear.findFirstOrThrow({ where: { id: h.ids.yearA } });
    expect(previous.status).toBe("CLOSED");
  });
});
