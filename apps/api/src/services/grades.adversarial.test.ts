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

describe("grade entry, deadline lock, and publish gate", () => {
  let h: Harness;
  let adminAToken: string;
  let adminBToken: string;
  let teacherToken: string;
  let parentAToken: string;
  let openPeriodId: string;
  let closedPeriodId: string;
  let summerPeriodId: string;
  let mathId: string;
  let otherYearId: string;
  let otherYearPeriodId: string;

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

    const cadence = await request(h.app)
      .patch(`/v1/schools/${h.ids.schoolA}/settings`)
      .set(bearer(adminAToken))
      .send({ gradeCadence: "CONTINUOUS", publishTiming: "IMMEDIATE", publishGraceHours: 0 });
    expectStatus(cadence, 200, "set continuous cadence");

    const today = utcToday();
    const closed = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(adminAToken))
      .send({
        number: 1,
        name: "Period 1",
        startDate: addUtcDays(today, -80),
        endDate: addUtcDays(today, -50),
        gradeEntryDeadline: `${addUtcDays(today, -48)}T12:00:00.000Z`,
      });
    expectStatus(closed, 201, "create closed-deadline period");
    closedPeriodId = closed.body.period.id;

    const open = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(adminAToken))
      .send({
        number: 2,
        name: "Period 2",
        startDate: addUtcDays(today, -10),
        endDate: addUtcDays(today, 40),
        gradeEntryDeadline: `${addUtcDays(today, 42)}T12:00:00.000Z`,
      });
    expectStatus(open, 201, "create open period");
    openPeriodId = open.body.period.id;

    const summer = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(adminAToken))
      .send({
        number: 1,
        type: "SUMMER",
        startDate: "2027-06-01",
        endDate: "2027-06-30",
        gradeEntryDeadline: "2027-07-02T12:00:00.000Z",
      });
    expectStatus(summer, 201, "create summer period");
    summerPeriodId = summer.body.period.id;

    const math = await h.prisma.subject.create({
      data: { schoolId: h.ids.schoolA, name: "Mathematics", nameNormalized: "mathematics", displayOrder: 2 },
    });
    mathId = math.id;
    await h.prisma.gradeLevelSubject.create({
      data: { schoolId: h.ids.schoolA, gradeLevelId: h.ids.gradeLevelA, subjectId: math.id },
    });

    const otherYear = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/academic-years`)
      .set(bearer(adminAToken))
      .send({ label: "2028/2029", startDate: "2028-08-01", endDate: "2029-07-31" });
    expectStatus(otherYear, 201, "create later year");
    otherYearId = otherYear.body.academicYear.id;
    const otherPeriod = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/periods`)
      .set(bearer(adminAToken))
      .send({
        number: 1,
        academicYearId: otherYearId,
        startDate: "2028-09-01",
        endDate: "2028-10-15",
        gradeEntryDeadline: "2028-10-17T12:00:00.000Z",
      });
    expectStatus(otherPeriod, 201, "period on other year");
    otherYearPeriodId = otherPeriod.body.period.id;
  });

  afterAll(async () => {
    await h.prisma.$disconnect();
  });

  it("lets a teacher enter and submit a draft for an assigned subject", async () => {
    const created = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades`)
      .set(bearer(teacherToken))
      .send({
        studentId: h.ids.studentAssigned,
        subjectId: h.ids.subjectLit,
        periodId: openPeriodId,
        assessmentType: "QUIZ",
        sequence: 1,
        score: 78,
      });
    expectStatus(created, 201, "teacher draft");
    expect(created.body.grade.state).toBe("DRAFT");
    expect(created.body.grade.countsTowardTally).toBe(true);

    const submitted = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/${created.body.grade.id}/submit`)
      .set(bearer(teacherToken))
      .send({});
    expectStatus(submitted, 200, "teacher submit");
    expect(submitted.body.grade.state).toBe("SUBMITTED");
    const audit = await h.prisma.auditLog.findFirst({
      where: { action: "GRADE_SUBMITTED", entityId: created.body.grade.id },
    });
    expect(audit?.actorStaffId).toBe(h.ids.teacherA);
  });

  it("rejects a teacher entering a grade for a subject they are not assigned to", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades`)
      .set(bearer(teacherToken))
      .send({
        studentId: h.ids.studentAssigned,
        subjectId: mathId,
        periodId: openPeriodId,
        assessmentType: "TEST",
        score: 70,
      });
    expectStatus(res, 403, "teacher unassigned subject");
  });

  it("rejects a teacher entering a grade for a section they are not assigned to", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades`)
      .set(bearer(teacherToken))
      .send({
        studentId: h.ids.studentOtherSection,
        subjectId: h.ids.subjectLit,
        periodId: openPeriodId,
        assessmentType: "QUIZ",
        score: 70,
      });
    expectStatus(res, 403, "teacher unassigned section");
  });

  it("rejects a teacher writing a grade in a year they are not assigned to", async () => {
    await h.prisma.enrollment.create({
      data: {
        schoolId: h.ids.schoolA,
        studentId: h.ids.studentAssigned,
        academicYearId: otherYearId,
        sectionId: h.ids.sectionAssigned,
        outcome: "PENDING",
      },
    });
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades`)
      .set(bearer(teacherToken))
      .send({
        studentId: h.ids.studentAssigned,
        subjectId: h.ids.subjectLit,
        periodId: otherYearPeriodId,
        assessmentType: "QUIZ",
        score: 70,
      });
    expectStatus(res, 403, "teacher other-year assignment");
  });

  it("rejects a grade write when the student is not enrolled in that period's year", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades`)
      .set(bearer(adminAToken))
      .send({
        studentId: h.ids.studentOtherSection,
        subjectId: h.ids.subjectLit,
        periodId: otherYearPeriodId,
        assessmentType: "HOMEWORK",
        score: 70,
      });
    expectStatus(res, 400, "not enrolled in period year");
  });

  it("rejects a teacher creating or submitting after the grade-entry deadline", async () => {
    const create = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades`)
      .set(bearer(teacherToken))
      .send({
        studentId: h.ids.studentAssigned,
        subjectId: h.ids.subjectLit,
        periodId: closedPeriodId,
        assessmentType: "QUIZ",
        score: 60,
      });
    expectStatus(create, 403, "teacher create after deadline");

    const draft = await h.prisma.gradeEntry.create({
      data: {
        schoolId: h.ids.schoolA,
        studentId: h.ids.studentAssigned,
        subjectId: h.ids.subjectLit,
        periodId: closedPeriodId,
        assessmentType: "QUIZ",
        sequence: 1,
        score: 60,
        state: "DRAFT",
        version: 1,
      },
    });
    const submit = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/${draft.id}/submit`)
      .set(bearer(teacherToken))
      .send({});
    expectStatus(submit, 403, "teacher submit after deadline");
  });

  it("rejects an admin amending past the deadline without a reason", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades`)
      .set(bearer(adminAToken))
      .send({
        studentId: h.ids.studentAssigned,
        subjectId: h.ids.subjectLit,
        periodId: closedPeriodId,
        assessmentType: "TEST",
        score: 55,
      });
    expectStatus(res, 400, "admin deadline without reason");
  });

  it("lets an admin amend past the deadline with a reason and audits it", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades`)
      .set(bearer(adminAToken))
      .send({
        studentId: h.ids.studentAssigned,
        subjectId: h.ids.subjectLit,
        periodId: closedPeriodId,
        assessmentType: "TEST",
        score: 55,
        reason: "Score sheet arrived after the deadline.",
      });
    expectStatus(res, 201, "admin deadline with reason");
    const audit = await h.prisma.auditLog.findFirst({
      where: { action: "GRADE_DEADLINE_AMENDED", entityId: res.body.grade.id },
    });
    expect(audit?.actorStaffId).toBe(h.ids.adminA);
    const metadata = audit?.metadata as { reason: string };
    expect(metadata.reason).toContain("Score sheet");
  });

  it("rejects a teacher approving or publishing", async () => {
    const draft = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades`)
      .set(bearer(teacherToken))
      .send({
        studentId: h.ids.studentAssigned,
        subjectId: h.ids.subjectLit,
        periodId: openPeriodId,
        assessmentType: "HOMEWORK",
        score: 88,
      });
    expectStatus(draft, 201, "homework draft");
    const submitted = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/${draft.body.grade.id}/submit`)
      .set(bearer(teacherToken))
      .send({});
    expectStatus(submitted, 200, "homework submit");

    const approve = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/${submitted.body.grade.id}/approve`)
      .set(bearer(teacherToken))
      .send({});
    expectStatus(approve, 403, "teacher approve");

    const publish = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/publish`)
      .set(bearer(teacherToken))
      .send({ periodId: openPeriodId, sectionId: h.ids.sectionAssigned });
    expectStatus(publish, 403, "teacher publish");
  });

  it("hides Draft, Submitted, and Approved grades from a parent", async () => {
    const draft = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades`)
      .set(bearer(adminAToken))
      .send({
        studentId: h.ids.studentAssigned,
        subjectId: h.ids.subjectLit,
        periodId: openPeriodId,
        assessmentType: "EXAM",
        score: 91,
      });
    expectStatus(draft, 201, "exam draft");
    const parentDraft = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}/grades`)
      .set(bearer(parentAToken));
    expectStatus(parentDraft, 200, "parent list while draft");
    expect(parentDraft.body.grades.some((row: { id: string }) => row.id === draft.body.grade.id)).toBe(false);

    const submitted = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/${draft.body.grade.id}/submit`)
      .set(bearer(adminAToken))
      .send({});
    expectStatus(submitted, 200, "exam submit");
    const parentSubmitted = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}/grades`)
      .set(bearer(parentAToken));
    expect(parentSubmitted.body.grades.some((row: { id: string }) => row.id === draft.body.grade.id)).toBe(false);

    const approved = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/${draft.body.grade.id}/approve`)
      .set(bearer(adminAToken))
      .send({});
    expectStatus(approved, 200, "exam approve");
    const parentApproved = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}/grades`)
      .set(bearer(parentAToken));
    expect(parentApproved.body.grades.some((row: { id: string }) => row.id === draft.body.grade.id)).toBe(false);
  });

  it("rejects a publish request that carries a student list", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/publish`)
      .set(bearer(adminAToken))
      .send({
        periodId: openPeriodId,
        sectionId: h.ids.sectionAssigned,
        studentIds: [h.ids.studentAssigned],
      });
    expectStatus(res, 400, "publish student list");
  });

  it("does not show an approved cohort to a parent until the grace window elapses", async () => {
    const settings = await request(h.app)
      .patch(`/v1/schools/${h.ids.schoolA}/settings`)
      .set(bearer(adminAToken))
      .send({ publishTiming: "GRACE_WINDOW", publishGraceHours: 48 });
    expectStatus(settings, 200, "enable grace window");

    const exam = await h.prisma.gradeEntry.findFirstOrThrow({
      where: {
        studentId: h.ids.studentAssigned,
        periodId: openPeriodId,
        assessmentType: "EXAM",
      },
    });
    const published = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/publish`)
      .set(bearer(adminAToken))
      .send({ periodId: openPeriodId, sectionId: h.ids.sectionAssigned });
    expectStatus(published, 200, "publish section cohort");
    expect(published.body.published).toBeGreaterThan(0);

    const duringGrace = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}/grades`)
      .set(bearer(parentAToken));
    expectStatus(duringGrace, 200, "parent during grace");
    expect(duringGrace.body.grades.some((row: { id: string }) => row.id === exam.id)).toBe(false);

    await h.prisma.gradeEntry.update({
      where: { id: exam.id },
      data: { publishedAt: new Date(Date.now() - 49 * 60 * 60 * 1000) },
    });
    const afterGrace = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}/grades`)
      .set(bearer(parentAToken));
    expectStatus(afterGrace, 200, "parent after grace");
    const visible = afterGrace.body.grades.find((row: { id: string }) => row.id === exam.id);
    expect(visible).toBeTruthy();
    expect(visible.state).toBe("PUBLISHED");
    expect(Number(visible.score)).toBe(91);
  });

  it("hides the score when a published grade is under review", async () => {
    const exam = await h.prisma.gradeEntry.findFirstOrThrow({
      where: {
        studentId: h.ids.studentAssigned,
        periodId: openPeriodId,
        assessmentType: "EXAM",
        state: "PUBLISHED",
      },
    });
    const flagged = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/${exam.id}/under-review`)
      .set(bearer(adminAToken))
      .send({ underReview: true });
    expectStatus(flagged, 200, "mark under review");

    const parent = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}/grades`)
      .set(bearer(parentAToken));
    expectStatus(parent, 200, "parent under review");
    const row = parent.body.grades.find((item: { id: string }) => item.id === exam.id);
    expect(row).toBeTruthy();
    expect(row.score).toBeNull();
    expect(row.underReviewLabel).toBe("under review");

    const clear = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/${exam.id}/under-review`)
      .set(bearer(adminAToken))
      .send({ underReview: false });
    expectStatus(clear, 200, "clear under review");
  });

  it("creates a new version when correcting a published score and keeps the old value", async () => {
    const exam = await h.prisma.gradeEntry.findFirstOrThrow({
      where: {
        studentId: h.ids.studentAssigned,
        periodId: openPeriodId,
        assessmentType: "EXAM",
        state: "PUBLISHED",
      },
    });
    const corrected = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/${exam.id}/correct`)
      .set(bearer(adminAToken))
      .send({ score: 96, reason: "Recount after appeal." });
    expectStatus(corrected, 200, "correct published");
    expect(corrected.body.grade.version).toBe(exam.version + 1);
    expect(corrected.body.grade.state).toBe("DRAFT");
    expect(Number(corrected.body.grade.score)).toBe(96);

    const old = await h.prisma.gradeEntry.findUniqueOrThrow({ where: { id: exam.id } });
    expect(Number(old.score.toString())).toBe(91);
    expect(old.state).toBe("PUBLISHED");

    const audit = await h.prisma.auditLog.findFirst({
      where: { action: "GRADE_CORRECTED", entityId: corrected.body.grade.id },
    });
    expect(audit?.actorStaffId).toBe(h.ids.adminA);
    const metadata = audit?.metadata as {
      previousScore: string;
      previousVersion: number;
      notifyParent: boolean;
      reason: string;
    };
    expect(Number(metadata.previousScore)).toBe(91);
    expect(metadata.previousVersion).toBe(exam.version);
    expect(metadata.notifyParent).toBe(true);
    expect(metadata.reason).toContain("Recount");
  });

  it("rejects a cross-school grade write", async () => {
    const viaPath = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolB}/grades`)
      .set(bearer(adminAToken))
      .send({
        studentId: h.ids.studentB,
        subjectId: h.ids.subjectLit,
        periodId: openPeriodId,
        assessmentType: "QUIZ",
        score: 50,
      });
    expectStatus(viaPath, 403, "admin A writing school B");

    const viaBody = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades`)
      .set(bearer(adminAToken))
      .send({
        studentId: h.ids.studentB,
        subjectId: h.ids.subjectLit,
        periodId: openPeriodId,
        assessmentType: "QUIZ",
        score: 50,
      });
    expectStatus(viaBody, 404, "school B student on school A");

    const fromB = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades`)
      .set(bearer(adminBToken))
      .send({
        studentId: h.ids.studentAssigned,
        subjectId: h.ids.subjectLit,
        periodId: openPeriodId,
        assessmentType: "QUIZ",
        score: 50,
      });
    expectStatus(fromB, 403, "admin B writing school A");
  });

  it("never counts a summer grade toward the tally", async () => {
    const res = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades`)
      .set(bearer(adminAToken))
      .send({
        studentId: h.ids.studentAssigned,
        subjectId: h.ids.subjectLit,
        periodId: summerPeriodId,
        assessmentType: "TEST",
        score: 40,
      });
    expectStatus(res, 201, "summer grade");
    expect(res.body.grade.countsTowardTally).toBe(false);
  });

  it("lists missing submissions from current assignments, not a stored flag", async () => {
    const before = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/periods/${openPeriodId}/missing-submissions`)
      .set(bearer(adminAToken));
    expectStatus(before, 200, "missing submissions");
    expect(
      before.body.missing.some(
        (row: { sectionId: string; subjectId: string }) =>
          row.sectionId === h.ids.sectionAssigned && row.subjectId === h.ids.subjectLit,
      ),
    ).toBe(false);

    await h.prisma.subjectAssignment.create({
      data: {
        schoolId: h.ids.schoolA,
        academicYearId: h.ids.yearA,
        teacherId: h.ids.teacherA,
        subjectId: mathId,
        sectionId: h.ids.sectionAssigned,
      },
    });
    const after = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/periods/${openPeriodId}/missing-submissions`)
      .set(bearer(adminAToken));
    expectStatus(after, 200, "missing math");
    expect(
      after.body.missing.some(
        (row: { sectionId: string; subjectId: string; teacherId: string }) =>
          row.sectionId === h.ids.sectionAssigned &&
          row.subjectId === mathId &&
          row.teacherId === h.ids.teacherA,
      ),
    ).toBe(true);

    const teacherMissing = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/periods/${openPeriodId}/missing-submissions`)
      .set(bearer(teacherToken));
    expectStatus(teacherMissing, 403, "teacher missing submissions");
  });

  it("blocks END_OF_PERIOD publish before the period ends, then allows it after", async () => {
    const locked = await request(h.app)
      .patch(`/v1/schools/${h.ids.schoolA}/settings`)
      .set(bearer(adminAToken))
      .send({ gradeCadence: "END_OF_PERIOD", publishTiming: "IMMEDIATE", publishGraceHours: 0 });
    expectStatus(locked, 200, "end of period cadence");

    const tooSoon = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/publish`)
      .set(bearer(adminAToken))
      .send({ periodId: openPeriodId, gradeLevelId: h.ids.gradeLevelA });
    expectStatus(tooSoon, 400, "publish before period end");

    const ok = await request(h.app)
      .post(`/v1/schools/${h.ids.schoolA}/grades/publish`)
      .set(bearer(adminAToken))
      .send({ periodId: closedPeriodId, gradeLevelId: h.ids.gradeLevelA });
    expectStatus(ok, 200, "publish after period end");
  });

  it("lets a parent see an INACTIVE child and hides a WITHDRAWN child", async () => {
    await h.prisma.student.update({
      where: { id: h.ids.studentAssigned },
      data: { status: "INACTIVE" },
    });
    const inactive = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}/grades`)
      .set(bearer(parentAToken));
    expectStatus(inactive, 200, "parent inactive child");

    const withdrawn = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentWithdrawn}/grades`)
      .set(bearer(parentAToken));
    expectStatus(withdrawn, 404, "parent withdrawn child");
  });
});
