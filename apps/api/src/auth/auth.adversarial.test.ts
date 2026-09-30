import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  PASSWORD_A,
  PASSWORD_B,
  PASSWORD_SUPER,
  PASSWORD_TEACHER,
  PIN_A,
  PIN_SHARED,
  bearer,
  createHarness,
  expectStatus,
  type Harness,
} from "../test/helpers.ts";

describe("authentication and authorization", () => {
  let h: Harness;
  let adminAToken: string;
  let adminARefresh: string;
  let teacherToken: string;
  let parentAToken: string;
  let adminBToken: string;
  let superToken: string;

  beforeAll(async () => {
    h = await createHarness();
    const adminA = await request(h.app)
      .post("/v1/auth/staff/login")
      .send({ email: "admin.a@school.test", password: PASSWORD_A });
    expectStatus(adminA, 200, "admin A login");
    adminAToken = adminA.body.accessToken;
    adminARefresh = adminA.body.refreshToken;

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

    const adminB = await request(h.app)
      .post("/v1/auth/staff/login")
      .send({ email: "admin.b@school.test", password: PASSWORD_B });
    expectStatus(adminB, 200, "admin B login");
    adminBToken = adminB.body.accessToken;

    const superAdmin = await request(h.app)
      .post("/v1/auth/staff/login")
      .send({ email: "super@platform.test", password: PASSWORD_SUPER });
    expectStatus(superAdmin, 200, "super admin login");
    superToken = superAdmin.body.accessToken;
  });

  afterAll(async () => {
    await h.prisma.$disconnect();
  });

  it("logs staff in with username as well as email", async () => {
    const res = await request(h.app)
      .post("/v1/auth/staff/login")
      .send({ username: "admin.a", password: PASSWORD_A });
    expectStatus(res, 200, "username login");
    expect(res.body.user.role).toBe("school_admin");
    expect(res.body.user.schoolId).toBe(h.ids.schoolA);
    expect(res.body.expiresInSeconds).toBe(15 * 60);
  });

  it("rejects a wrong staff password with the same error as an unknown email", async () => {
    const wrong = await request(h.app)
      .post("/v1/auth/staff/login")
      .send({ email: "admin.a@school.test", password: "definitely-wrong" });
    const unknown = await request(h.app)
      .post("/v1/auth/staff/login")
      .send({ email: "nobody@school.test", password: "definitely-wrong" });
    expectStatus(wrong, 401, "wrong password");
    expectStatus(unknown, 401, "unknown email");
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(wrong.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a teacher token on an admin-only endpoint", async () => {
    const res = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/staff`)
      .set(bearer(teacherToken));
    expectStatus(res, 403, "teacher hitting admin staff list");
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects a parent token on an admin-only endpoint", async () => {
    const res = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/staff`)
      .set(bearer(parentAToken));
    expectStatus(res, 403, "parent hitting admin staff list");
  });

  it("rejects an expired access token", async () => {
    const expired = jwt.sign(
      {
        sub: h.ids.adminA,
        typ: "access",
        role: "school_admin",
        kind: "staff",
        schoolId: h.ids.schoolA,
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      h.config.jwtAccessSecret,
      { algorithm: "HS256" },
    );
    const res = await request(h.app).get("/v1/me").set(bearer(expired));
    expectStatus(res, 401, "expired access token");
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const forged = jwt.sign(
      {
        sub: h.ids.adminA,
        typ: "access",
        role: "school_admin",
        kind: "staff",
        schoolId: h.ids.schoolA,
      },
      "this-is-not-the-real-secret-value-at-all-32chars",
      { algorithm: "HS256", expiresIn: "15m" },
    );
    const res = await request(h.app).get("/v1/me").set(bearer(forged));
    expectStatus(res, 401, "forged access token");
  });

  it("rejects a request with no Authorization header", async () => {
    const res = await request(h.app).get("/v1/me");
    expectStatus(res, 401, "missing token");
  });

  it("rejects a School A admin reaching School B's staff list", async () => {
    const res = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolB}/staff`)
      .set(bearer(adminAToken));
    expectStatus(res, 403, "cross-school staff list");
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects a School A admin fetching a School B student on School B's path", async () => {
    const res = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolB}/students/${h.ids.studentB}`)
      .set(bearer(adminAToken));
    expectStatus(res, 403, "cross-school student by path");
  });

  it("returns 404 when a School A admin asks for a School B student under School A's path", async () => {
    const res = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentB}`)
      .set(bearer(adminAToken));
    expectStatus(res, 404, "cross-school student id guess");
  });

  it("lets a School A admin read School A staff and a School A student", async () => {
    const staff = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/staff`)
      .set(bearer(adminAToken));
    expectStatus(staff, 200, "admin A staff list");
    expect(staff.body.staff.some((row: { email: string }) => row.email === "teacher.a@school.test")).toBe(true);

    const student = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}`)
      .set(bearer(adminAToken));
    expectStatus(student, 200, "admin A student");
    expect(student.body.student.name).toBe("Amina Kollie");
  });

  it("lets a teacher read a student in an assigned section and rejects one in an unassigned section", async () => {
    const allowed = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}`)
      .set(bearer(teacherToken));
    expectStatus(allowed, 200, "teacher assigned student");

    const denied = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentOtherSection}`)
      .set(bearer(teacherToken));
    expectStatus(denied, 403, "teacher unassigned section student");

    const listDenied = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/sections/${h.ids.sectionOther}/students`)
      .set(bearer(teacherToken));
    expectStatus(listDenied, 403, "teacher unassigned section list");

    const listAllowed = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/sections/${h.ids.sectionAssigned}/students`)
      .set(bearer(teacherToken));
    expectStatus(listAllowed, 200, "teacher assigned section list");
  });

  it("lets a parent see a linked active child and hides unlinked or withdrawn children", async () => {
    const own = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentAssigned}`)
      .set(bearer(parentAToken));
    expectStatus(own, 200, "parent linked child");

    const unlinked = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentOtherSection}`)
      .set(bearer(parentAToken));
    expectStatus(unlinked, 404, "parent unlinked child");

    const withdrawn = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolA}/students/${h.ids.studentWithdrawn}`)
      .set(bearer(parentAToken));
    expectStatus(withdrawn, 404, "parent withdrawn child");

    const otherSchool = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolB}/students/${h.ids.studentB}`)
      .set(bearer(parentAToken));
    expectStatus(otherSchool, 403, "parent cross-school");
  });

  it("lets a super_admin read another school's admin-only staff list", async () => {
    const res = await request(h.app)
      .get(`/v1/schools/${h.ids.schoolB}/staff`)
      .set(bearer(superToken));
    expectStatus(res, 200, "super admin cross-school staff list");
  });

  it("rotates refresh tokens and rejects reuse of the old one", async () => {
    const first = await request(h.app).post("/v1/auth/refresh").send({ refreshToken: adminARefresh });
    expectStatus(first, 200, "refresh rotation");
    expect(first.body.accessToken).toBeTruthy();
    expect(first.body.refreshToken).not.toBe(adminARefresh);

    const reused = await request(h.app).post("/v1/auth/refresh").send({ refreshToken: adminARefresh });
    expectStatus(reused, 401, "refresh reuse");

    const second = await request(h.app)
      .post("/v1/auth/refresh")
      .send({ refreshToken: first.body.refreshToken });
    expectStatus(second, 401, "family revoked after reuse");
  });

  it("locks a parent after too many bad PIN attempts", async () => {
    for (let i = 0; i < 5; i += 1) {
      const failed = await request(h.app)
        .post("/v1/auth/parent/login")
        .send({ phone: "+231770000002", pin: "000000" });
      expectStatus(failed, 401, `parent bad pin attempt ${i + 1}`);
    }
    const lockedWrong = await request(h.app)
      .post("/v1/auth/parent/login")
      .send({ phone: "+231770000002", pin: "000000" });
    expectStatus(lockedWrong, 429, "parent lockout with wrong pin");
    expect(lockedWrong.body.error.code).toBe("LOCKED_OUT");

    const lockedRight = await request(h.app)
      .post("/v1/auth/parent/login")
      .send({ phone: "+231770000002", pin: "135790" });
    expectStatus(lockedRight, 429, "parent lockout even with correct pin");
  });

  it("asks for a school when the same phone exists at two schools", async () => {
    const ambiguous = await request(h.app)
      .post("/v1/auth/parent/login")
      .send({ phone: "+231770000099", pin: PIN_SHARED });
    expectStatus(ambiguous, 409, "multi-school phone without schoolId");
    expect(ambiguous.body.error.code).toBe("SCHOOL_SELECTION_REQUIRED");

    const picked = await request(h.app)
      .post("/v1/auth/parent/login")
      .send({ phone: "+231770000099", pin: PIN_SHARED, schoolId: h.ids.schoolB });
    expectStatus(picked, 200, "multi-school phone with schoolId");
    expect(picked.body.user.schoolId).toBe(h.ids.schoolB);
  });

  it("lets a parent change their PIN and then log in with the new one", async () => {
    const login = await request(h.app)
      .post("/v1/auth/parent/login")
      .send({ phone: "+231770000001", pin: PIN_A });
    expectStatus(login, 200, "parent login before pin change");
    expect(login.body.user.mustChangePin).toBe(true);

    const changed = await request(h.app)
      .post("/v1/auth/parent/pin")
      .set(bearer(login.body.accessToken))
      .send({ currentPin: PIN_A, newPin: "998877" });
    expectStatus(changed, 204, "parent pin change");

    const oldPin = await request(h.app)
      .post("/v1/auth/parent/login")
      .send({ phone: "+231770000001", pin: PIN_A });
    expectStatus(oldPin, 401, "old pin after change");

    const newPin = await request(h.app)
      .post("/v1/auth/parent/login")
      .send({ phone: "+231770000001", pin: "998877" });
    expectStatus(newPin, 200, "new pin after change");
    expect(newPin.body.user.mustChangePin).toBe(false);
  });

  it("rejects a teacher trying to change a parent PIN", async () => {
    const res = await request(h.app)
      .post("/v1/auth/parent/pin")
      .set(bearer(teacherToken))
      .send({ currentPin: PIN_A, newPin: "111111" });
    expectStatus(res, 403, "teacher changing parent pin");
  });
});
