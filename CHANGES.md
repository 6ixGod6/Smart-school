# CHANGES

Running changelog per CLAUDE.md §12. Newest entry first.

---

## 2026-10-01 — Review rework A1–A3 + step 2 backend (periods, attendance, settings)

### What changed and why

Three code-review items from step 1, then §14 step 2 **backend only** (no React admin UI).

**A1. Cross-school rows are now impossible at the database.** Child tables that carry both `school_id` and a parent id now point at `UNIQUE (school_id, id)` on the parent. Prisma can attach `schoolId` to only one relation per model, so the remaining tenant FKs (parent–student link → student, assignment → teacher/subject, grade entry → period/subject, and so on) live in migration `20261001120000_tenant_composite_fks`. A test inserts a School A student into a School B section (and a cross-school parent–student link) and asserts PostgreSQL rejects it.

**A2. Refresh tokens left the JSON body.** Login/refresh set an httpOnly cookie (`refresh_token`, `SameSite=Lax`, `Secure` in production, `Path=/v1/auth`). The access token still comes back in JSON. `/v1/auth/refresh` and `/v1/auth/logout` read the cookie. Path is the auth prefix, not only `/v1/auth/refresh`, so logout can clear the same cookie without sending it to attendance or fee routes. Same-origin deploy (`/api` on the PWA domain) is the intended production shape.

**A3. Multi-school parent login proves the PIN first.** A phone at two schools no longer returns `SCHOOL_SELECTION_REQUIRED` before a correct PIN. Wrong PIN on a multi-school number is the same generic 401 as an unknown phone. A PIN that matches exactly one school logs in with no picker. Identical PINs at two schools then return the picker, naming schools only — never children.

**Lockout (A3):** failed-attempt counters increment only when the caller has named a school (`schoolId`) or when the phone maps to a single parent row. A typo against a multi-school number without `schoolId` returns 401 and does **not** bump every school that phone belongs to. Once the client sends `schoolId`, lockout is per that school's parent row; locking School A does not lock School B.

**B1–B5. Periods, attendance, period lock, school settings.** School admins create/update/list periods 1–6 (semester 1 = 1–3, semester 2 = 4–6), with start/end/grade-entry deadline, no overlap, `endDate` after `startDate`. Teachers upsert attendance for assigned sections (`recordedByStaffId`). Dates in a period whose `end_date` has passed are read-only for teachers (403, no override). A school admin may amend a closed period only with a non-empty reason; each change writes `ATTENDANCE_CLOSED_PERIOD_AMENDED` (who, when, student, old/new status, reason). Period is resolved from the date — no `periodId` on `AttendanceRecord`. School settings (`gradeCadence`, `publishTiming`, `publishGraceHours`, `attendanceVisibleToParents`, `attendanceCountsTowardGrade`) are GET/PATCH on the existing `School` columns. Teachers see assigned sections; admins see any section in their school; parents see linked ACTIVE children only if `attendanceVisibleToParents` is true.

### Dependencies added

None. No new packages.

### High-risk: authentication and tenancy

- Refresh token is no longer readable by JavaScript in the PWA. XSS can still steal the short-lived access token; it cannot steal the refresh cookie. Cookie `Secure` is on in production only (tests and local HTTP omit it).
- Tenant consistency is enforced by PostgreSQL composite FKs, not only application filters. Application authorization (role + `school_id` on every school-scoped request) is unchanged and still required.
- Parent login no longer discloses “this phone is a multi-school parent” to an unauthenticated caller. School names appear only after a PIN that matches more than one school.
- Attendance writes check role, school, teacher assignment, and period lock on the server. Parents cannot write. School A cannot mark School B. Teachers cannot write into a closed period; admins need a reason plus an audit row.

### Tests (actual output)

```
$ pnpm --filter @smart-school/api test

 RUN  v5.0.3 C:/Projects/Smart-school/apps/api

 Test Files  4 passed (4)
      Tests  39 passed (39)
   Start at  09:22:29
   Duration  27.93s
```

`pnpm --filter @smart-school/api typecheck` (`tsc --noEmit`) also passed.

Adversarial coverage added this step:

- Database rejects a student whose `schoolId` does not match the section, and a parent–student link across schools.
- Refresh token is httpOnly / SameSite=Lax / Path=/v1/auth and absent from the JSON body; rotation still kills reuse; body `refreshToken` is ignored.
- Wrong PIN on a multi-school phone → 401 (not 409); unique PIN at one of two schools → login, no picker; identical PIN → selection payload with school id/name only; named-school lockout does not lock the other school.
- Teacher marking an unassigned section → 403.
- Teacher writing into a closed period → 403.
- Admin amending a closed period without a reason → 400; with a reason → 200 + audit row.
- School A user touching School B attendance → 403.
- Parent attendance write → 403.
- Parent attendance read when `attendanceVisibleToParents` is false → 403.

Failures: none in this run.

---

## 2026-09-30 — Step 1: monorepo, schema, auth

### What changed and why

Set up the pnpm monorepo (§1), a private GitHub repo (§2), the full multi-tenant Prisma schema (§3), and staff/parent authentication with server-side authorization (§5). Admin dashboard and parent PWA are empty directories only — no screens, no fee/event/notification APIs.

- **Monorepo:** `apps/api` (Express), `packages/shared` (Prisma schema + client factory), `apps/admin` and `apps/parent` as placeholders for later steps.
- **Schema:** every table in §3, plus identity/session tables §5 requires that §3 never named (`StaffUser`, `Parent`, `RefreshToken`, `AuditLog`). `school_id` is a real column, indexed, on every tenant-scoped table — including tables whose §3 bullets omitted it (Section, AttendanceRecord, GradeEntry, Payment, Receipt, etc.). A test fails if a `school_id` column exists without an index.
- **Auth:** staff email or username + password (bcrypt); parent phone + 6-digit PIN (bcrypt). JWT access tokens (15 minutes) + opaque refresh tokens (parents 60 days, staff 7 days). Role claims `parent` / `teacher` / `school_admin` / `super_admin`. Teachers are further scoped by `SubjectAssignment` (section + subject) on every request, loaded from the database rather than trusted from the token.
- **Authorization:** every school-scoped endpoint checks role **and** that `req.params.schoolId` matches the token's `school_id` (super_admin is the only exception, and is platform-scoped). Hiding a control in the UI is not used as a gate. Cross-school ID guesses return 404 when the path school matches the token but the row belongs elsewhere; a mismatched path school returns 403.
- **Lockout:** 5 failed PIN/password attempts lock the account for 15 minutes. Unknown identifiers still run a dummy bcrypt compare so timing does not leak whether the account exists.
- **Audit log:** login success/failure/lockout, refresh-token reuse, and PIN changes write a row. Grade-publish and payment-create logging will attach to those endpoints when they are built.

Three small read endpoints exist only so authorization can be tested against real rows (`GET /v1/me`, `GET /v1/schools/:schoolId/staff`, `GET /v1/schools/:schoolId/students/:studentId`, `GET /v1/schools/:schoolId/sections/:sectionId/students`). They are not product features.

Forgot-PIN SMS is **not** built — that is §14 step 9d.

### Decisions that need a look (not silent deviations — translations of gaps)

These are the places §3/§5 were incomplete or used array notation. Implemented as follows; say if any should be different before step 2.

1. **Identity tables.** §3 never lists Staff, Parent, sessions, or audit. They are required by §5, so they were added.
2. **`school_id` on child tables.** §3's opening rule ("every table is scoped by `school_id`") wins over bullets that omitted the column. The column is denormalized onto Section, AttendanceRecord, GradeEntry, Payment, etc., so a query cannot "forget" the join and still compile.
3. **Arrays → join tables.** `Payment.charge_item_ids[]` is `PaymentChargeItem`. `GradeGroup.grade_level_ids[]` is `GradeGroupGradeLevel`. Same meaning, with foreign keys.
4. **Audience.** Stored as its own table with JSON `include`/`exclude` (the spec's rule shape) plus `AudienceSnapshotMember` for the publish-time snapshot §7 requires. ChargeBatch and Event point at it. Announcement is not a table yet (notifications are step 9).
5. **Parent identity is school-scoped.** Unique `(school_id, phone)`, not phone globally. Same guardian at two schools has two accounts; login without `schoolId` returns `SCHOOL_SELECTION_REQUIRED`. This keeps one JWT = one `school_id`. A global parent identity would punch a hole in the tenancy rule.
6. **Refresh tokens are opaque, not JWTs.** Stored as SHA-256(`pepper + token`). Rotation + family reuse detection. Access tokens stay JWTs as specified.
7. **Refresh token is returned in the JSON body**, not an httpOnly cookie. Admin web and parent PWA will be different origins from the API; cookies need a CORS/credentials design that does not exist yet. Can switch to cookies when the admin app is same-site.
8. **School settings from §6** (grade cadence, publish timing/grace, attendance visibility) live as columns on `School`. Not a second table.
9. **`Payment.parent_id`** is extra relative to the §3 bullet list — a payment is made by a parent. `PaymentProvider.MANUAL` is included because §9 records bursar cash payments.
10. **PIN change is a prompt, not a hard gate.** §5 says the parent is prompted to keep the temp PIN or set their own. Other endpoints still work with `mustChangePin: true`.

### Dependencies added

Every package was checked against the npm registry (abbreviated metadata + last-week download counts) before install. `prisma`'s `latest` tag is currently an 8.0 RC (~20M weekly downloads as a package); it was **not** used. Pinned to stable **7.10.0** to match `@prisma/client`. TypeScript `latest` is 7.0.2 (native port); pinned to **5.9.3** so tsc/vitest stay on the widely used compiler.

| Package | Version | Why |
|---|---|---|
| `express` | 5.2.1 | HTTP API |
| `@prisma/client` | 7.10.0 | Generated query client |
| `prisma` | 7.10.0 | Schema, migrate, generate |
| `@prisma/adapter-pg` | 7.10.0 | Prisma 7 requires a driver adapter |
| `pg` | 8.23.0 | PostgreSQL driver for the adapter |
| `@types/pg` | 8.23.1 | Types for `pg` |
| `bcrypt` | 6.0.0 | Hash staff passwords and parent PINs as specified (not bcryptjs) |
| `@types/bcrypt` | 6.0.0 | Types |
| `jsonwebtoken` | 9.0.3 | Sign/verify access tokens |
| `@types/jsonwebtoken` | 9.0.10 | Types |
| `zod` | 4.6.5 | Env + request body validation |
| `dotenv` | 18.0.4 | Load `.env` for API and Prisma CLI |
| `helmet` | 8.3.0 | Baseline HTTP headers |
| `cors` | 2.8.6 | Browser origins for later admin/parent apps |
| `@types/cors` | 2.8.19 | Types |
| `express-rate-limit` | 8.7.0 | IP-level login throttle on top of per-account lockout |
| `typescript` | 5.9.3 | Typecheck |
| `tsx` | 4.23.15 | Run TypeScript in development |
| `vitest` | 5.0.3 | Test runner |
| `supertest` | 7.3.0 | HTTP assertions against the Express app |
| `@types/supertest` | 7.2.1 | Types |
| `@types/express` | 5.0.6 | Types |
| `@types/node` | 22.20.4 | Node 22 typings (runtime is v22.23.2) |

pnpm 11 blocks lifecycle scripts until listed in `pnpm-workspace.yaml` `allowBuilds`. Allowed only: `bcrypt`, `esbuild`, `prisma`, `@prisma/engines`, `@prisma/client`.

### High-risk: authentication and authorization

This whole step is a severe-scrutiny surface (§5).

- Access tokens are JWTs signed with `JWT_ACCESS_SECRET` (HS256, 15 min). They are **not** revocable except by waiting out expiry; logout revokes the refresh token only. Principal is re-loaded from the database on every request (active flag, current role, current school, current teacher assignments). Stale claims (role or school changed) are rejected.
- Refresh tokens are random 32-byte values, hashed with a separate `REFRESH_TOKEN_PEPPER` before storage. Reuse of a revoked token in a family revokes the whole family.
- Teacher tokens calling `GET /v1/schools/:schoolId/staff` (admin-only) are **403**.
- Expired / forged / missing access tokens are **401**.
- School A tokens on School B paths are **403**. School A tokens asking for a School B student id under School A's path are **404**.
- Teachers cannot read students outside their `SubjectAssignment` sections (**403**).
- Parents cannot see unlinked students or withdrawn linked students (**404**, so existence is not confirmed).
- MoMo receiving-number change flow, grade publish, and payment creation are **not** built yet. The columns for the school's receiving numbers exist on `School` and must not be exposed to the teacher role when those endpoints are added.

Local `.env` (gitignored) currently points at the existing local Postgres role `montserrado` on this machine so tests can run. Production secrets belong in Railway, never in the repo.

### Tests (actual output)

```
$ pnpm --filter @smart-school/api test

 RUN  v5.0.3 C:/Projects/Smart-school/apps/api

 Test Files  2 passed (2)
      Tests  20 passed (20)
   Start at  13:33:57
   Duration  4.45s (tests 47%, import 41%, transform 11%, setup 1%)
```

`pnpm --filter @smart-school/api typecheck` (`tsc --noEmit`) also passed after the run above.

What the 20 tests cover:

- Staff login by email and by username; parent login by phone + PIN.
- Wrong password and unknown email return the same 401 message.
- Teacher token on admin-only staff list → 403.
- Parent token on admin-only staff list → 403.
- Expired access token → 401.
- Token signed with the wrong secret → 401.
- Missing Authorization header → 401.
- School A admin → School B staff list → 403.
- School A admin → School B student on School B's path → 403.
- School A admin → School B student id under School A's path → 404.
- School A admin can read School A staff and a School A student → 200.
- Teacher can read an assigned-section student → 200; unassigned section student / list → 403.
- Parent sees linked active child → 200; unlinked child → 404; withdrawn linked child → 404; other school → 403.
- Super-admin can read School B's staff list → 200.
- Refresh rotation issues a new token; reuse of the old one → 401; the rotated family is then dead → 401.
- Parent lockout after 5 bad PINs → 429 even with the correct PIN.
- Same phone at two schools without `schoolId` → 409 `SCHOOL_SELECTION_REQUIRED`; with `schoolId` → 200.
- Parent PIN change; old PIN then 401; new PIN 200.
- Teacher cannot change a parent PIN → 403.
- Every table that has `school_id` also has an index on it.

Failures: none in this run.
