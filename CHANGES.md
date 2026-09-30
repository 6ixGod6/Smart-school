# CHANGES

Running changelog per CLAUDE.md §12. Newest entry first.

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
