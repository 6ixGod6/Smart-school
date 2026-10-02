# Smart School — Build Specification

> Working name only: "Smart School." Rename freely once a real name is picked — search/replace, nothing below depends on the name.

This is the single source of truth for this project. Every decision below was made deliberately over several planning sessions — do not silently deviate from it. If something here seems wrong or you find a better approach, **flag it and ask before changing it**, especially anything under "Security-critical surfaces" or "Money flow."

---

## 0. What this is

A school–parent communication platform for K-12 schools in Liberia: attendance, grades/report cards, and fee payments (MTN Mobile Money / Orange Money), sold to schools as a SaaS product. Multi-tenant from day one — built to onboard many independent schools on one codebase, not just one school.

Two front ends, one backend:
- **Admin web dashboard** — for school administrators and teachers (attendance, grade entry, publishing, fee management, finance overview).
- **Parent PWA** — installable to the phone home screen, no App Store / Play Store submission, ever. Parents view their children's grades, attendance, and fees, and pay via mobile money.

---

## 1. Tech stack

- **Backend:** Node.js, Express, Prisma ORM, PostgreSQL (Railway to start).
- **Admin web:** React (web dashboard for admins/teachers).
- **Parent app:** React + Vite (or equivalent), built and shipped as an installable PWA — service worker + manifest, no native app store submission.
- **Auth:** JWT access tokens (~15 min) + refresh tokens. bcrypt for all stored credentials (staff passwords, parent PINs).
- **Payments:** MTN Mobile Money + Orange Money APIs (Collection + Disbursement products). Sandbox credentials already exist from the Montserrado Ride project — reuse that integration pattern.
- **Notifications:** Web Push only for v1 (standard Web Push + VAPID, free, sent from our own API — no third-party notification service), backed by an in-app notification centre, plus an SMS provider for the single SMS use case (PIN reset). WhatsApp is deferred — see §10.
- **Hosting:** Railway to start; PgBouncer connection pooling planned before scaling past a handful of schools.
- **Repo:** monorepo, pnpm (or npm) workspaces:
  ```
  /apps/api          — Express + Prisma backend
  /apps/admin        — React admin dashboard
  /apps/parent       — React PWA (parent-facing)
  /packages/shared   — shared TypeScript types, Prisma schema, constants
  CLAUDE.md          — this file, kept at repo root
  CHANGES.md         — running changelog (see §12)
  ```

---

## 2. GitHub setup (do this first, before any feature code)

Cursor already has GitHub connected to this account.

1. Initialize git in the project root if not already: `git init`.
2. Create a **new, private** GitHub repository (name: `smart-school` unless told otherwise) under the connected GitHub account.
3. Add a `.gitignore` covering: `node_modules/`, `.env`, `.env.*`, `dist/`, `build/`, `.expo/` (if ever needed), generated Prisma client output, OS/editor cruft.
4. Never commit real secrets (API keys, DB URLs, MoMo credentials, WhatsApp/BSP credentials) — these live in `.env` files locally and in Railway's environment variable settings in production. Commit a `.env.example` with empty/placeholder keys instead.
5. Add this file as `CLAUDE.md` at the repo root, and start `CHANGES.md` (see §12) with an initial entry.
6. First commit: "Initial commit: project scaffold." Push to `main`.
7. Branch discipline: feature branches per module (`feature/auth`, `feature/fee-ledger`, etc.), even solo — keeps the reporting protocol in §12 meaningful and gives a clean history to audit later.

---

## 3. Multi-tenant data model

Every table below is scoped by `school_id`. **Every query must filter by `school_id` — this is the entire security boundary between schools, not just a UI convenience.** A parent or admin at School A must never be able to retrieve School B's data through any endpoint, direct ID guess included.

### Core hierarchy
```
School
 └── GradeLevel (1st Grade, 2nd Grade, ... Senior 12th)
      └── Section (e.g. "1st Grade A", "1st Grade B")
           └── Student
```

### Key tables
- **School** — `id`, `name`, `id_prefix` (unique platform-wide, see §4), mobile money account details, created_at.
- **GradeLevel** — `id`, `school_id`, `name`, `order`.
- **Section** — `id`, `grade_level_id`, `name`.
- **Student** — `id`, `school_id`, `student_code` (e.g. `RIC-26-0123`, see §4), `section_id`, `name`, `status` (`Active` / `Withdrawn` / `Graduated` / `Inactive`), `enrolled_at`.
- **ParentStudentLink** — `parent_id`, `student_id`, `relationship`. This table — not a self-service "add my child" feature — is the only thing that grants a parent visibility into a student. Only school admins create this link, at enrollment, by entering a guardian phone number on the student's record.
- **Subject** — `id`, `school_id`, `name` (unique per school, case-insensitive/trimmed), `archived_at` (nullable — never hard-delete once grades exist against it), `display_order`.
- **GradeLevelSubject** — link table mapping subjects to grade levels. Teachers can only be assigned subjects mapped to their grade/section — no mismatches possible. Lock a grade level's subject list once grade entry has started for the current period (or require confirmation to change it).
- **SubjectAssignment** — `teacher_id`, `subject_id`, `section_id`.
- **Period** — `id`, `school_id`, `name` (1st–6th), `semester` (1st periods 1–3, 2nd periods 4–6 — standard Liberian structure), `start_date`, `end_date`, `grade_entry_deadline`.
- **AttendanceRecord** — `student_id`, `date`, `status` (present/absent/late), recorded daily, mandatory.
- **GradeEntry** — `student_id`, `subject_id`, `period_id`, `assessment_type` (quiz/test/homework/exam), `score`, `state` (`Draft` → `Submitted` → `Approved` → `Published`), `version` (see §6), `under_review` (boolean, see §6).
- **GradeGroup** — `id`, `school_id`, `name` (e.g. "Elementary", "Junior High", "Senior High"), `grade_level_ids[]`. Defined once per school at setup; lets an audience target a band of grades in one selection (§7).
- **Audience** — the shared targeting rule (§7), stored on whatever owns it (`ChargeBatch`, `Event`, announcement): `include` (`scope_type` school/grade_group/grade_levels/sections/students + ids) and `exclude` (grade_levels/sections/students + ids). Resolved to a concrete student list at publish; the resolution is recorded, not recomputed.
- **ChargeBatch** — `id`, `school_id`, `title`, `type`, `amount`, `due_date`, `audience`, `state` (`Draft` / `Published` / `Cancelled`), `source_event_id` (nullable), `created_by`, `published_at`, `cancelled_at`. Publishing generates the `FeeChargeItem` rows; edit, cancel and reporting all operate here rather than on individual rows.
- **FeeChargeItem** — `id`, `school_id`, `student_id`, `type` (tuition/registration/uniform/transportation/exam/PTA/etc.), `amount`, `due_date`, `status` (unpaid/partial/paid/overdue), `charge_batch_id` (nullable — the batch that generated it), `source_event_id` (nullable — set when the charge came from an event, see §8).
- **Event** — `id`, `school_id`, `title`, `description`, `type` (activity/meeting/holiday/exam/trip/other), `start_at`, `end_at` (nullable, for multi-day), `location` (nullable), `audience` (see above), `state` (`Draft` / `Published` / `Cancelled`), `fee_amount` (nullable), `fee_mode` (`mandatory` / `opt_in`, nullable), `created_by`, `published_at`, `cancelled_at`. See §8.
- **EventParticipation** — `event_id`, `student_id`, `confirmed_by` (parent_id), `confirmed_at`, `declined_at` (nullable). Only used for `opt_in` events; a confirmation is what generates that student's `FeeChargeItem`, and the set of confirmations is the school's headcount.
- **Payment** — `id`, `charge_item_ids[]` (a payment can cover one or many charges — see §7), `amount`, `momo_fee`, `total_charged`, `provider` (MTN/Orange), `status`, `transaction_ref`, `paid_at`.
- **Receipt** — generated per payment, downloadable, itemized by charge covered.
- **Notification** — `id`, `school_id`, `parent_id`, `student_id`, `category` (academic/attendance/financial/school), `title`, `body`, `created_at`, `read_at` (nullable), `channel` attempted, `delivery_status`, plus `link_type` + `link_id` (the record this notification deep-links to — a fee charge, a report, an attendance date, a receipt) and `resolves_when` (nullable — the condition that clears it from the "Needs your attention" section, e.g. the linked charge reaching `paid`, rather than merely being read). **Every** notification writes a row here regardless of channel — this table backs the in-app notification centre, which is the guaranteed-visibility fallback described in §10.
- **PushSubscription** — `id`, `parent_id`, `endpoint`, `p256dh_key`, `auth_key`, `user_agent`/device label, `created_at`, `last_seen_at`, `revoked_at` (nullable). One row per parent device; a parent may have several. Prune on repeated delivery failure (the browser returns 404/410 for a dead subscription — delete it rather than retrying forever).

### Scale expectations
Designed for ~50 schools × ~500 students (~25,000 students) as the near-term target. PostgreSQL handles this comfortably. Index `school_id` and `student_id` on every large table. Plan to partition `AttendanceRecord` and `GradeEntry` by school year once volume grows. Use PgBouncer before scaling past a handful of schools.

### Prisma-invisible constraints — do not let `migrate dev` drop these

Prisma can attach `schoolId` to only one relation per model. Tenant isolation and several academic-year rules therefore live in **hand-written SQL** that `schema.prisma` does not express. `prisma migrate dev` diffs the schema against a shadow database and will offer to `DROP CONSTRAINT` / `DROP INDEX` anything it cannot see. **If that is accepted, tenant isolation disappears while application tests can still pass.**

**Every generated migration must be read for `DROP CONSTRAINT` / `DROP INDEX` before it is applied.** If a drop targets one of the names below, reject the migration and keep the SQL.

The living assertion list is `PRISMA_INVISIBLE_CONSTRAINTS` in `apps/api/src/auth/schema.indexes.test.ts`. Adding a new raw-SQL constraint means adding it there too.

Composite tenant foreign keys (`*_tenant_fkey`):
`sections_grade_level_tenant_fkey`, `parent_student_links_parent_tenant_fkey`, `parent_student_links_student_tenant_fkey`, `grade_level_subjects_grade_level_tenant_fkey`, `grade_level_subjects_subject_tenant_fkey`, `subject_assignments_section_tenant_fkey`, `subject_assignments_teacher_tenant_fkey`, `subject_assignments_subject_tenant_fkey`, `subject_assignments_year_tenant_fkey`, `attendance_records_student_tenant_fkey`, `grade_entries_student_tenant_fkey`, `grade_entries_subject_tenant_fkey`, `grade_entries_period_tenant_fkey`, `grade_group_grade_levels_group_tenant_fkey`, `grade_group_grade_levels_level_tenant_fkey`, `audience_snapshot_members_audience_tenant_fkey`, `audience_snapshot_members_student_tenant_fkey`, `charge_batches_audience_tenant_fkey`, `charge_batches_creator_tenant_fkey`, `charge_batches_event_tenant_fkey`, `charge_batches_year_tenant_fkey`, `fee_charge_items_student_tenant_fkey`, `fee_charge_items_batch_tenant_fkey`, `fee_charge_items_event_tenant_fkey`, `events_audience_tenant_fkey`, `events_creator_tenant_fkey`, `event_participations_event_tenant_fkey`, `event_participations_student_tenant_fkey`, `event_participations_parent_tenant_fkey`, `payments_parent_tenant_fkey`, `payment_charge_items_payment_tenant_fkey`, `payment_charge_items_charge_tenant_fkey`, `receipts_payment_tenant_fkey`, `notifications_parent_tenant_fkey`, `notifications_student_tenant_fkey`, `push_subscriptions_parent_tenant_fkey`, `periods_year_tenant_fkey`, `enrollments_year_tenant_fkey`, `enrollments_student_tenant_fkey`, `enrollments_section_tenant_fkey`.

Academic-year rules:
- `academic_years_one_active_per_school` — partial unique index (`WHERE status = 'ACTIVE'`)
- `academic_years_dates_no_overlap`, `periods_dates_no_overlap` — gist exclusion
- `periods_summer_no_grade_tally`, `periods_summer_no_semester`, `academic_years_date_order`, `grade_entries_sequence_positive` — CHECK

`students_section_tenant_fkey` was dropped when placement moved to `Enrollment`; do not recreate it.

---

## 4. Student IDs and subjects

- **Student ID:** auto-generated per school, never admin-typed: `{school_prefix}-{enrollment_year}-{sequential_number}`, e.g. `RIC-26-0123`. Retired permanently on withdrawal — never reused. Shown on report cards, receipts, and the parent's child view. **Never used for login** — login is phone + PIN (§5).
- **School ID prefix:** chosen by the admin at onboarding. Enforced **unique platform-wide**, not just per school. If the chosen prefix already exists, show a popup: "This prefix is already in use — please choose another," not a silent block.
- **Subjects:** admin picks per grade level from a starter list (English, Mathematics, General Science / Biology-Chemistry-Physics for senior grades, Social Studies, Civics, French, Agriculture, Bible Knowledge, ICT, Physical Education) plus free-form "Add Custom Subject." Enforce per-school uniqueness. Never hard-delete a subject with grades against it — archive instead.

---

## 5. Authentication

### Staff (teachers / school admins / super admin)
- Email or username + password (bcrypt-hashed).
- Role claims: `parent` / `teacher` / `school_admin` / `super_admin`.
- Teachers are scoped further to their specific `section_id` + `subject_id` combinations via `SubjectAssignment` — a 1st Grade literature teacher cannot enter 3rd Grade chemistry grades, enforced server-side, not just hidden in the UI.

### Parents — phone + PIN (not OTP-only)
This is a deliberate design, arrived at after discussion — do not simplify it back to OTP-only or a full alphanumeric password without checking with Jerome first. **This same phone number also carries the WhatsApp notification and mobile-money billing roles — see §10.**

1. **Enrollment:** when a student is enrolled and a guardian phone number is entered, the system auto-generates a **6-digit temporary PIN**. Primary delivery is a **printed credential slip** handed to the parent at the PTA/enrollment meeting, where the admin also installs the PWA with them (see §10) — not a text message. SMS delivery of the same credentials is available as a fallback for a guardian who missed the meeting.
2. **First login:** parent logs in with phone + temporary PIN, then is prompted to keep it or set their own 6-digit PIN. PIN is bcrypt-hashed, never stored plaintext.
3. **Routine login:** phone + PIN. No OTP needed every time — this matters for notification/SMS cost control (see §10).
4. **Forgot PIN:** "Forgot PIN" → enter phone number → OTP sent via **SMS** → enter OTP → set new PIN. OTP is used **only** for this recovery step, not routine login, and stays on SMS rather than WhatsApp specifically because account recovery shouldn't depend on a channel that can silently fail (opted out, WhatsApp uninstalled, etc.).
5. **Multi-child:** if the same guardian phone is used for a second child, auto-link that child to the existing parent account rather than creating a duplicate login. A student record supports multiple guardian phone numbers (repeatable "Add Guardian").
6. **Lockout:** rate-limit PIN attempts (e.g. 5 failed attempts → cooldown or forced OTP-based reset) to protect a short PIN from brute force.
7. **Session length:** parents should stay logged in for a long time (weeks) so routine use doesn't repeatedly hit SMS/OTP costs.

### Security-critical surfaces — severe scrutiny required
The admin session — viewing school earnings, publishing grades, creating/managing payments — is the highest-risk surface in this codebase. AI-generated code can look correct while silently failing to enforce access control. Specifically:

- **Never trust the frontend to gate access.** Hiding a "Publish Grades" or "Create Payment" button from a teacher's UI is not authorization. Every sensitive endpoint must independently verify role AND school_id server-side, on every request.
- **Test for the failure, not the success.** A real test for the grade-publish gate logs in as a teacher and calls the admin-only publish endpoint directly; tries an expired token; tries a token from School A against School B's data. These must be *rejected*. A test that only checks the happy path proves nothing.
- **Every sensitive action is logged**: who published which grades, who created which payment, with a timestamp — traceable after the fact, not a mystery.
- Watch for "looks right" vs. "is right" throughout — not just here. This includes verifying that any package/library Cursor wants to install actually exists (real npm/PyPI listing, real download history) before installing it — guards against package hallucination and slopsquatting.

---

## 6. Grades, attendance, and the publish gate

- **Assessment types:** one or two quizzes per subject per period, plus a periodic test — the Liberian norm.
- **Grade state machine:** `Draft` → `Submitted` → `Approved` → `Published`. Parents only ever see `Published`.
- **Per-school configurable cadence** — must support both:
  - **Continuous mode:** teachers enter quiz/test/homework scores as they happen; admin reviews and publishes throughout the period (saves admin time at period-end, gives parents ongoing visibility).
  - **End-of-period mode:** everything published together at period end.
  - This is a **school-level setting**, not hardcoded.
- **Publish timing option:** a school can publish each approved score immediately, or add a grace window (e.g. 48 hours) before it becomes visible — this covers grade corrections/appeals (a poor quiz score, a redo, a better result) without parents seeing the pre-correction number.
- **Under Review flag:** if a student appeals a score, admin marks it `under_review` — parent sees a neutral "under review" label instead of the raw score until resolved.
- **Correcting a published score:** never edits silently. Create a new version, keep the old one in an audit log, and notify the parent that the grade was updated.
- **Attendance:** mandatory to record every day, no school-level opt-out on this. Whether attendance is shown to parents during the period, and whether it counts toward the period grade tally, are school-level settings.
- **Period/semester structure:** periods 1–6; periods 1–3 = first semester, 4–6 = second semester. Example deadline flow: period ends Sept 30 → teacher grade-entry deadline Oct 2 → parent-visible by Oct 3 (subject to the publish-timing setting above). Semester report auto-compiles once all 3 periods in that semester are published.
- **Missing submissions:** if a teacher hasn't submitted grades by the deadline, flag it to the admin — never silently leave it blank.
- **New school year rollover:** admin runs a bulk "Promote Section" action (e.g. 3rd Grade A → 4th Grade A). Any student not included is auto-flagged "not promoted / not re-enrolled" for manual admin follow-up.
- **Student lifecycle:** use a `status` enum (`Active`/`Withdrawn`/`Graduated`/`Inactive`), never hard-delete. `Withdrawn` (including a `TRANSFERRED` enrollment outcome) and `Graduated` hide the child from the parent app and from on-roll / billable counts. `Inactive` is a student still on the roll (medical leave, suspension) — they stay visible to the linked parent and still count toward the $15/year platform fee. Filter parent visibility on `status in (Active, Inactive)`.

---

## 7. Fee ledger and payments

### Ledger structure
Every charge (tuition, registration, admission, examination, uniform, books, transportation, meals, boarding, sports, activities, graduation, PTA, ID cards, technology fees, misc.) is its own `FeeChargeItem` row tied to `student_id`. Admin creates the fee structure; the system generates each student's obligations; parents see only what applies to their own children.

Charges are never created as loose rows. An admin creates a **`ChargeBatch`** — title, type, amount, due date, and an audience (below) — and publishing the batch generates one `FeeChargeItem` per student in the resolved audience, each linked back to the batch. Editing, cancelling and reporting then all work at the level the admin actually thinks in ("cancel the gala fee"), instead of requiring 400 individual row operations. Event fees (§8) work the same way, with the event as the batch's source.

### Audience targeting — one shared primitive
**Fee charges (§7), events (§8) and announcements (§10) all target parents the same way. Implement this once and reuse it — do not build three separate targeting mechanisms.**

**An audience is: include rules, minus exclude rules.**

*Include* (any combination, additive):
- Whole school
- A grade group (below)
- One or more grade levels
- One or more sections
- Individually named students

*Exclude* (any combination, applied after includes):
- Grade levels, sections, or individually named students

Cases this must handle, all of them real:

| Intent | Audience |
|---|---|
| Gala week contribution | Whole school |
| Junior high trip | Grade levels 7, 8, 9 — or the "Junior High" group, one click |
| A single class activity | Section 7A |
| A fee graduating students don't pay | Whole school, exclude grade 12 |
| Trip fee with scholarship cases | Grade 7, exclude 3 named students |

**Grade groups.** Each school defines its own groupings once at setup — typically Elementary / Junior High / Senior High — mapping to its own grade levels. Admins then target "Junior High" rather than multi-selecting three grades every time. This matches how school staff talk about their students and removes a repeated source of selection error.

**Mandatory live preview before publish.** The audience selector must show, and keep updated as the admin changes the selection:
- how many students match
- how many parents will be notified
- where a fee is attached, the per-student amount and the **total being charged**

For example: *"142 students in Junior High · 138 parents notified · $15 each · $2,130 total."* This is the single most important guard in the whole targeting feature — an admin who means 142 students and sees 1,248 catches the mistake before it reaches 400 families, not after. Publish must not be reachable without this figure being displayed.

**Resolution: snapshot at publish, then flag drift.** Resolve the audience to a concrete list of students at publish time, and generate charges and notifications against that list. Do **not** re-evaluate the rules continuously: a student who enrolls in November must never silently acquire a September gala fee. Where a student later enrolls into the audience's scope, surface it on the batch or event as a prompt — *"3 students have since enrolled in Junior High and are not included"* — with a one-click add. The admin decides; the system never creates debt retroactively on its own.

The exception is recurring structural charges such as per-period tuition for a grade level, which should be regenerated each period against current enrolment rather than carried forward from a stale snapshot.

**Why this matters beyond tidiness:** a parent who is notified about things that don't concern their child stops reading notifications altogether, which silently breaks the fee reminders and report-card alerts the product depends on. Over-broad targeting doesn't just annoy — it degrades every other notification in the system.

### Parent-facing payment screen (locked design — see §11 for the visual direction)
- **Every outstanding charge is its own card** with its own "Pay Now" — a parent can pay just the uniform fee if that's all they can afford right now.
- **A summary bar above the list** shows total outstanding with a single **"Pay All Now"** button — settles everything in one mobile money transaction.
- Both must coexist; it's the parent's choice each time.
- Every payment (whether single-item or Pay All) generates a **downloadable receipt**, itemized by which charge(s) it covered.

### Payment methods
- **MTN Mobile Money and Orange Money only.** No cards, no bank transfer, no other method.
- At enrollment, each parent provides the MTN/Orange number used for billing — **and this must be the same number they use for WhatsApp** (see §10). One number, three roles: login identity, notification delivery, and payment.

### The school's receiving mobile money number — a security-critical field
Every disbursement the school ever receives goes to this one number, so it is not an ordinary settings field. If an attacker with a compromised admin session changes it quietly, all school money redirects to them and nobody notices until the school asks where their term's collections went. Rules:

- **Set by a `school_admin` at school onboarding.** Teacher roles must never be able to read or write it.
- **Verify before saving.** MTN and Orange both expose an account-holder status check (`accountHolderActive` / `isPayerActive` in the MoMo API) — call it so a mistyped or inactive number cannot be saved silently. Where the provider exposes the registered account name, surface it to the admin for confirmation against the school's own name before saving.
- **Changing it later is a re-verified action, not a form submit:** require an OTP to the *currently registered* number (not the new one), and record the change in the audit log with who, when, old value and new value.
- **Notify on change** — every other admin at that school gets a notification when the receiving number changes, so a silent swap is impossible.
- Treat this alongside grade publishing and payment creation as one of the severe-scrutiny surfaces in §5.

### Money flow — collect first, then disburse
This must be documented for schools too, so they understand exactly how their money moves (build this into onboarding materials for schools, not just this codebase).

1. Parent pays → money is **collected** into the platform's MTN/Orange Collection account.
2. Platform then **disburses** the school's share to the school's own mobile money number (separate API product — Collection and Disbursement are not automatically linked; this is two calls, not one split payment).
3. **First payment per student per year:** the $15/year platform line item is deducted from this payment and credited to Jerome's account; the school's complimentary $5 (see §13 for the full pricing model) goes to the school's account; the platform fee is taken out only once per student per year, from whichever payment comes first.
4. **Every payment after that** goes straight to the school's account (still via collect → disburse, just no platform-fee deduction).
5. Confirm with MTN/Orange (in progress — Jerome verifying): whether disbursement carries its own fee separate from the 2.5% collection fee, and whether operating this collect/disburse flow needs Central Bank of Liberia licensing or a specific merchant agreement.

### Mobile money transaction fee (2.5%) — shown to the parent, never absorbed by the platform
Mobile money takes ~2.5% off the top of what it processes, so simply adding 2.5% to the sticker price still leaves the school short. **Gross up the amount so the school always receives its full, exact charge:**

```
amount_charged_to_parent = school_amount / (1 - momo_fee_rate)
```

rounded up to the cent. Example at 2.5%: a $200 tuition installment → parent is charged **$205.13**, the $5.13 momo fee is shown as its own line before they confirm, and the school still receives exactly $200. Apply this same formula to the $15/year platform-fee line item too. Make the fee rate a per-provider config value, not a hardcoded constant — confirm with both MTN and Orange that 2.5% actually applies uniformly before shipping.

---

## 8. School calendar & events

Schools set their own calendar — gala week, sports day, PTA meetings, field trips, exam weeks, holidays — and the platform's job is to let an admin create these, optionally attach a per-student cost, and publish them to parents. Same shape as everything else here: draft → publish → notify.

### Creating an event
A `school_admin` creates an Event with: title, description, type (activity / meeting / holiday / exam / trip / other), date (plus optional end date for multi-day items like gala week), start and end time, optional location, an **audience**, and an optional attached fee.

**Audience is required, not optional**, and uses the shared targeting primitive defined in §7 — include rules minus exclude rules, grade groups, live preview before publish, snapshot-at-publish resolution. A 7th-grade field trip must not notify every parent in the school.

### Attached fees — reuse the ledger, never build a second payment path
An event may carry a per-student cost. When it does, it generates `FeeChargeItem` rows (§7) linked back to the event, and the charge appears in the parent's normal fee list with its own Pay Now. No separate payment flow, no second ledger, no new MoMo code.

**Two fee modes, and the distinction is load-bearing:**
- **Mandatory** — charged to every student in the audience scope at publish time. For things every student owes regardless, e.g. an exam fee.
- **Opt-in** — **no charge is created at publish.** The event appears to parents with a confirmation action ("Yes, [child] will attend"), and the charge is generated only when a parent confirms. For trips, optional activities, anything a child may not attend.

Do not collapse these into one mode. Publishing a $15 field trip as a mandatory charge against 400 students creates real debt for every child staying home, and the bursar spends the week manually voiding charges. The opt-in flow also gives the school a live headcount they currently collect on paper.

### Publish gate
An event is `Draft` until an admin publishes it — same pattern as grades (§6). Publishing is the single action that makes it visible to parents, fires the notification, and generates any mandatory charges. Draft events are admin-only and generate nothing.

### Changing or cancelling a published event
- **Editing** date, time or details on a published event re-notifies the affected parents and surfaces as an update, not a silent change.
- **Cancelling** automatically voids any *unpaid* charges the event generated.
- **Charges already paid are never auto-refunded.** Present the admin with the list of affected payments and require a deliberate per-case resolution — refund via MoMo disbursement, or credit against another charge — recording which was chosen and by whom. Money that has already moved must never be reversed by an automated rule. This sits under the §5 severe-scrutiny surfaces.

### Parent-facing view
An "Events" view in the PWA: upcoming items in a simple chronological list, **not a month-grid calendar** — month grids are cramped on a phone and rarely used. Each entry shows the date, title, which of their children it applies to, and, where a fee is attached, the amount and its payment status, tapping through to pay or to confirm attendance. Past events collapse into a history section.

### Notifications
Event publication routes to the push tier (§10). Where a mandatory fee is attached, the resulting charge independently surfaces in the parent's "Needs your attention" section through the ledger — so a parent who misses the event notification still sees the money owed.

### Note on PTA meetings
The rollout model in §10 depends on PTA meetings for PWA installation and credential handout. Once a school's first cohort is onboarded, subsequent PTA meetings are announced through this module. The *first* meeting at a new school is necessarily announced the school's existing way — the module does not bootstrap itself, and onboarding materials should say so.

---

## 9. Admin financial intelligence dashboard

This was missing from the first pass — the admin dashboard needs its own dedicated revenue view, distinct from the per-student fee ledger above. This is the school-wide financial picture, the screen a bursar or principal opens first every morning:

- **School Revenue Overview:** Expected this term/year, Collected, Outstanding, Collection rate (%).
- **Per-grade breakdown:** a table of Expected / Collected / Outstanding per grade level, so the bursar can see which grade is lagging.
- **Outstanding balance buckets:** e.g. "$100+ owed: 42 students," "$500+ owed: 18 students" — each clickable through to the actual list of students and balances in that bucket.
- **Payments today:** broken out by channel — MTN / Orange / manual (cash or in-person, recorded by the bursar for the households that still pay that way).
- **Alerts panel** (carried over from the design mockups): overdue-accounts count, teachers who haven't submitted grades, students below the attendance threshold, reports awaiting admin approval — each clickable through to the underlying list.

**Important scope boundary — read before building this:** the platform never has API access to a school's own external mobile money wallet, only the ability to *send* money into it via the disbursement API (§7). **Do not build a "school's live MoMo account balance" widget — that number is not reachable from here**, since we hold no credentials to the school's own account. Show instead, from our own transaction records:
- **Disbursed to school** (this period / year-to-date) — total actually paid out to them so far.
- **Pending disbursement** — money already collected from parents but not yet paid out to the school (in transit, or retrying after a failed payout attempt). This is the operationally meaningful number: it tells the school what's coming without pretending to read a balance we can't see.

---

## 10. Notification channels & cost discipline

Two facts drive this whole section. First, Jerome's read on the ground in Liberia: parents largely ignore SMS, because carriers already flood the same numbers with spam and promotional messages all day, so people have stopped opening them — SMS is therefore not a viable notification channel here regardless of cost. Second, schools introduce anything new at a PTA meeting, which makes hands-on PWA installation realistic. Together those point at **Web Push as the notification channel, with SMS reduced to account recovery only.**

### Why WhatsApp is not free for us (settled — do not relitigate this)
A reasonable objection came up and was resolved, so it is recorded here rather than re-argued later: *parents in Liberia don't pay per WhatsApp message, they just need data — so why does the platform pay?*

Because the charge is on the **sender**, not the recipient, and consumer WhatsApp and the Business Platform are two different products:
- Carriers do **not** settle with Meta for WhatsApp traffic. A WhatsApp message is encrypted internet traffic over the carrier's data network; the carrier sells the bundle and keeps the money, and Meta earns nothing. Carrier "WhatsApp bundles" are the carrier zero-rating its own data, not a payment to Meta.
- That is precisely **why** the Business Platform is paid — selling automated business messaging is how Meta monetizes WhatsApp, since consumer messaging generates no revenue.
- This platform is in the paid category not because of who receives the message but because of what sends it: a server, on a schedule, to people who never initiated a conversation.

Routes that *are* free, and why they were rejected: the **WhatsApp Business app** (free, but a human types each message on a phone; broadcast lists cap at 256 and only reach people who saved your number — fine for a hand-typed "school closed Friday," useless for "John Doe's $200 is due Oct 10"); **unofficial automation libraries** (Baileys, whatsapp-web.js — against WhatsApp's terms, numbers doing automated bulk sending get banned with no appeal or support, and routing children's data and fee notices through an unsanctioned channel is not acceptable for a platform asking schools to trust it with money). **Do not implement either of these, and do not propose them as a cost saving.**

### Channel policy — Web Push only for v1

**Decision: ship v1 with Web Push as the only outbound notification channel. Do not build the WhatsApp Cloud API integration for the pilot.** It costs nothing, needs no Meta business verification, no template approval, and no third-party account, so it does not gate launch.

What makes this viable rather than reckless is the **rollout model**: schools in Liberia introduce anything new at a PTA meeting, and the plan is to use that meeting to install the PWA on each parent's phone and grant notification permission in the room, with the admin walking them through it. Hands-on installation at enrollment pushes realistic push coverage far above the ~50–70% you would expect from parents self-installing from a link.

| Channel | Cost | What routes here |
|---|---|---|
| **Web Push (PWA)** | Free | All notification categories below |
| **In-app notification centre** | Free | **Every** notification, always, regardless of whether push delivered |
| **SMS** | ~$0.06+/msg | PIN-reset OTP (§5) only. Nothing else. |

The in-app centre is not optional. Every notification writes a row to a list the parent can open and scroll, whether or not push delivered it. A failed, expired, or never-granted push subscription then degrades into "they see it next time they open the app" rather than a missing grade or an unseen fee notice.

### The in-app notification centre — spec
An activity feed in the parent PWA, in the shape people already know from Facebook or TikTok: a **bell icon with an unread count badge in the top-right of the header** (not a fifth bottom-nav tab — the bottom nav is already Home / Grades / Attendance / Payments), opening a scrollable list, newest first. Because this is the guaranteed-visibility layer under a best-effort push channel, it is load-bearing — **do not cut or simplify it if the build runs long.**

Requirements specific to this product:

- **Every row names the child.** A parent may have several children at the school; "Report card published" alone is useless. Each row reads as `John Doe — 3rd Period report card published`, with the child's name visually distinct. Provide a per-child filter at the top of the feed when the parent has more than one linked student.
- **Every row deep-links to the underlying thing**, not just to a detail view of the notification: payment due/overdue → that specific fee card with Pay Now ready; grade or report card published → that report; absence → the attendance record for that date; receipt available → the receipt. A notification centre that is only a log gets abandoned; one that is a set of shortcuts gets opened.
- **Two sections: "Needs your attention" and "Earlier."** The top section is driven by **state, not read status** — an overdue charge stays pinned there until the balance is actually paid, even if the parent read the notification weeks ago; a newly published report card stays flagged until it has been opened. Read-and-dismissed is the wrong model for money owed. The "Earlier" section is the ordinary reverse-chronological history, where read/unread behaves normally.
- **Read state:** `read_at` set on tap; a "mark all as read" affordance; the header badge counts unread rows in both sections.
- **Category styling** follows §11 — rust-tinted for overdue/financial-negative, amber for attention items, green for confirmations, neutral for announcements — always with a text label, never color alone.
- **Pagination and retention:** paginate the feed (do not load a full school year at once) and archive rows older than the current academic year rather than deleting them, since notification history is evidence in a fee dispute.
- **Dispute value:** because every notification is recorded server-side with its delivery attempts (§3 `Notification.delivery_status`), a school can show that a notice was generated and when, and the parent had it pinned in-app regardless of whether push reached the handset. This is the main mitigation for the "I never got the overdue notice" risk above — build it accordingly.

**Build the notification system channel-agnostic.** A single `notify(parent, category, payload)` service decides transport; Web Push is the only transport registered in v1. Adding WhatsApp later for payment events must be a new transport module plus a routing-table change — never a refactor of every call site. This matters because of the residual risks below.

### Known risks of push-only, and what to do about them
These are real and should be monitored during the pilot rather than assumed away:
- **Devices change.** Secondhand handsets, factory resets and phone swaps are common; a push subscription dies with the device and the parent must re-install and re-grant. Nobody notices until something important is missed.
- **Subscriptions expire silently**, particularly on iOS, and clearing browser data kills the service worker registration.
- **Payment disputes are the sharp edge.** "I never got the overdue notice" is the one case where a missed notification becomes an argument with the school about money.

Mitigations to build in v1: track `last_seen_at` per push subscription and surface a school-level "X% of your parents currently have notifications enabled" figure to admins so they can chase the gap at the next PTA meeting; show unread-notification state prominently in the app (badge on the bottom nav) so an unseen notification is still discoverable; and keep the WhatsApp option documented below so it can be switched on for payment events if the pilot shows real delivery gaps.

### Enrollment credential delivery — printed slip, not SMS
At enrollment the parent has nothing installed, so push cannot deliver their install link and temporary PIN. **The primary delivery method is a printed slip handed to the parent at the PTA/enrollment meeting**, carrying the child's name and student ID, the guardian phone number on file, and the temporary PIN — issued while the admin installs the app with them. This is free and completes at a far higher rate than a text message that may be ignored.

The admin dashboard therefore needs a **printable credential slip** per student (and a batch print for a whole section) as a real feature, not an afterthought. SMS delivery of credentials stays available as a fallback for a guardian who missed the meeting, and SMS otherwise only ever fires for a forgotten PIN later.

### Web Push — the free tier, and its real limits
Implement with the standard Web Push protocol and VAPID keys (e.g. the `web-push` npm library) straight from `/apps/api`. No Firebase project, no third-party service, and no per-message cost — delivery rides the browser vendors' own push networks (FCM for Chrome/Android, APNs for Safari). Store one `PushSubscription` row per parent device (§3).

Requirements on our side are the standard PWA set: HTTPS, a web manifest with `name`, `short_name`, 192px and 512px icons, `start_url` and `display: standalone`, plus a registered service worker.

**Two install paths — build both, detect the platform and show the right one.** Do not assume a single flow.

**Android (Chrome) — one-tap install.** Chrome fires a `beforeinstallprompt` event; capture it, suppress the default mini-infobar, and wire it to an in-app "Install App" button placed where the admin can point at it during the PTA meeting. Chrome then generates a **WebAPK** — a real Android package signed by Google — so the result has a home screen icon, an app-drawer entry, its own task in the app switcher, a splash screen, and an entry under Settings → Apps. It is indistinguishable from a Play Store install to the parent. Push also works on Android *without* installing, from the browser alone, so an Android parent who skips install is still reachable.

**iOS (Safari) — guided manual install.** There is no `beforeinstallprompt` equivalent; the parent must tap Share → Add to Home Screen themselves. Build a short illustrated walkthrough screen (arrow pointing at the Share control, the two steps spelled out) that shows only on iOS Safari. **On iOS there is no push at all without home-screen install** — no install, no notifications, full stop. The rollout plan is for admins to walk parents through this in person at the PTA/enrollment meeting, so the walkthrough screen is a teaching aid for the admin as much as for the parent.

Other constraints that must shape the UX, not be discovered later:
- **Permission must be requested at the right moment.** Do *not* fire the browser permission prompt on first page load — reflex denials are sticky and hard for a non-technical parent to reverse from browser settings. Prompt right after the first successful login (which, under the rollout plan, happens with the admin sitting beside them), or immediately after a first successful payment.
- **Track per-parent subscription state**, including `last_seen_at`, so the backend knows whether a given parent is reachable at all, and so a school-level coverage figure can be shown to admins (see the risks section above).
- **iOS web push is less reliable than Android** — subscriptions can expire silently and are lost if the PWA is removed from the home screen. Treat an iOS parent as needing periodic re-confirmation.

### Notification categories (routed per the table above)
- **Academic:** new grade, progress report released, report card released, teacher comment, academic warning.
- **Attendance:** student absent, student late, attendance threshold reached.
- **Financial:** invoice generated, payment successful, payment failed, payment due, payment overdue, balance changed, receipt available.
- **School:** announcement, holiday, event, emergency notification.

Parents can set preferences per category; school admins can mark specific categories mandatory (emergency notifications and payment-overdue can't be turned off by a parent). Preferences control *whether* a category notifies, not *which tier* it uses — tier assignment is a platform decision per the table above.

**School announcements are targeted, not broadcast.** Any admin-composed announcement uses the shared audience primitive in §7 — whole school, a grade group, specific grade levels or sections, with exclusions, and the same live preview of how many parents will receive it before it can be sent. A parent who keeps receiving notices about grades their child isn't in will stop reading all of them, which silently disables the fee reminders and report-card alerts this product depends on.

### Enrollment requirement — the phone number IS the WhatsApp number
State this explicitly, both in the product and in the paper onboarding materials given to schools and parents: **the phone number a guardian provides at enrollment must be the same number they use for WhatsApp and for MTN/Orange Mobile Money.** One number carries all three roles — login identity, WhatsApp delivery, and payment billing. Enrollment screens and onboarding paperwork must say this plainly, so a parent doesn't hand over a different number by accident and then wonder why nothing arrives. If a parent later reports missing notifications, "is this number actually active on WhatsApp" is the first troubleshooting question.

### WhatsApp — deferred, not cancelled (reference for if/when it is switched on)
WhatsApp is **not built in v1** per the channel policy above. This section is kept so the decision does not have to be re-researched if pilot delivery gaps make a guaranteed channel worth paying for. If it is added, it goes on payment events first (due / confirmed / failed / overdue), since those are the ones where non-delivery costs someone money.

**If added: integrate Meta's WhatsApp Cloud API directly. Do not route through Twilio, 360dialog, Gupshup or any other Business Solution Provider.** That was settled on both cost and build effort:

- **Cost.** Meta charges no platform or subscription fee on the Cloud API — you pay only the per-message rate. Liberia falls in the **"Rest of Africa"** tier: **$0.0040 per utility message** (the category these notifications fall under) and $0.0225 for marketing (which this product does not send). A BSP is pure markup on top of that: Twilio adds roughly **$0.005 per message**, more than doubling the cost; 360dialog charges a flat ~€99 per number per month, which only pays off at volumes far beyond this product's.
- **Projected spend** (utility rate, no BSP): ~$300/yr at 2,500 students × 30 messages each; ~$3,000/yr at 25,000 students × 30 each; ~$12,000/yr in a heavy continuous-grade-notification scenario (25,000 × 120 each). That is roughly **$0.12–$0.48 per student per year against $10/student platform revenue** — and around 15× cheaper than the same volume over SMS.
- **Build effort — no separate backend or service is needed.** Sending a message is an HTTPS `POST` to `graph.facebook.com/{version}/{phone_number_id}/messages` with a bearer token, issued straight from the existing Express API. Delivery-status callbacks are one additional Express webhook route. This is the same integration shape as the MTN/Orange MoMo work (token → REST call → callback URL) — build it as another provider module inside `/apps/api`, not as a standalone service.

### Other WhatsApp requirements — read before building this
- **Templates:** outbound business-initiated notifications require **pre-approved message templates** — you cannot free-type the way you would over SMS. Draft and submit the templates this product needs (enrollment credentials, payment confirmation, payment overdue, payment due reminder, grade published, report card released, absence alert, school announcement) early — approval is a dependency, not an afterthought.
- **Business verification:** the Cloud API needs a verified Meta Business account, which requires legal business documents. Start this **before** the notification feature is built — it is the slowest part of the whole integration and gates going live.
- **Messaging tier limits:** a newly registered number starts capped at roughly 250 business-initiated conversations per rolling 24 hours, and scales automatically (1K → 10K → 100K → unlimited) with sending volume and a good quality rating. That cap is fine for the one-school pilot but must be climbed well before the 25,000-student target — another reason to register and start sending early rather than at launch.
- **Consent:** platform policy requires the recipient to have opted in to business messages before template notifications are sent. Enrollment — where the parent hands over their number for exactly this purpose, with the requirement above stated up front — should satisfy this, but build the opt-in into the enrollment screen as an explicit line of text or a checkbox, not an assumption.
- **Free allowance (minor):** 1,000 free *service* messages per month per business number — these are free-form replies inside a 24-hour customer-initiated window, not the business-initiated templates this product sends, so do not model any meaningful saving from it.

*Rates above are from Meta's October 2026 rate card as reported by third-party pricing trackers; confirm current figures against [Meta's own pricing documentation](https://developers.facebook.com/docs/whatsapp/pricing) before relying on them for budgeting.*

### SMS cost note (for the one remaining SMS use case — PIN reset)
Get real bulk-SMS quotes from MTN and Orange directly. Third-party estimates for Liberia ranged roughly $0.06–$0.27 per message depending on provider and volume. Since SMS is now used only for enrollment-recovery and PIN resets rather than routine notifications, volume should stay low enough that provider choice matters far less than it would have under an all-SMS design.

---

## 11. Design system — "Savanna Gold"

Locked in after reviewing five directions on a design canvas. Apply consistently across both the admin dashboard and the parent PWA — they should read as one product.

### Palette
| Token | Hex | Use |
|---|---|---|
| Primary (green) | `#1F5D3D` | Headers, primary identity elements (avatars, active nav state), KPI highlight tiles |
| Accent (gold) | `#DBA43A` | Pay Now / Pay All buttons, progress-bar fill, calls to action — the one color that should visually mean "act here" |
| Background | `#F6F3EA` | Page/app background — warm cream, not stark white or sage |
| Card background | `#F3EDE0` | Fee cards, panel backgrounds |
| Card border | `#E3D3B8` | Borders on cards/panels |
| Text primary | `#2B2A22` | Body text, headings on light backgrounds |
| Text muted | `#7A7360` | Secondary/meta text (dates, labels) |
| Status — paid/positive | `#2F7D4E` | "Collected," "Paid" |
| Status — pending/warning | `#B9861E` | "Outstanding," pending review |
| Status — overdue/negative | `#A83F2A` | Overdue amounts, alerts — a warm rust, not a harsh pure red |

Never rely on color alone to distinguish status — always pair with a text label ("Paid," "Overdue," "Pending"), not just a colored dot.

### Typography
- **Display/headings:** Fraunces (serif, warm) — via Google Fonts (`family=Fraunces:wght@500;600;700`).
- **Body:** Karla (clean humanist sans) — via Google Fonts (`family=Karla:wght@400;500;600;700`).
- No Inter, Roboto, or Arial — deliberately avoided as generic/AI-default choices.

### Component patterns established in the mockups
- **Radius:** 12–16px on cards and buttons; 32–44px on the phone bezel mockup itself (not applicable to real screens, just the presentation mockup).
- **Fee cards:** rounded card, charge name + amount (rust if overdue) + due date + its own "Pay Now" button, gold background.
- **Pay-all summary bar:** solid green background, white/cream text, total outstanding + one gold "Pay All Now" button.
- **KPI tiles (admin):** 4-across grid, cream card background, one tile (Collection Rate) inverted to solid green with white text as the visual anchor of the row.
- **Alerts list (admin):** each alert is its own soft-colored pill (rust-tinted for overdue, amber-tinted for attendance/grade-submission issues, blue-tinted for neutral items like "reports awaiting approval") — never a plain bulleted list.
- **Bottom nav (parent PWA):** Home / Grades / Attendance / Payments, simple stroke icons (no filled icons, no emoji), active state colored green, inactive muted gray-green.
- **Header bell + unread badge (parent PWA):** stroke bell icon top-right of the header on every screen, with a small rust-filled badge carrying the unread count (cap the display at `9+`). Opens the notification centre (§10). The badge is the only place in the parent UI where a filled color shape is used purely for attention — keep it that way so it reads as urgent.
- Touch targets ≥44px throughout. Real semantic elements (`<button>`, `<a href>`, labeled `<input>`) — never `onClick` on a bare `<div>`.

*(If useful, ask Jerome for the design canvas link with the five explored directions — the winning direction and four rejected alternates are all there for reference.)*

---

## 12. Reporting & review protocol (mandatory for every build/commit)

Jerome will not personally review every line of AI-generated code. This protocol exists so problems can still be caught and flagged without full manual code review. Every build or commit must report:

1. **What changed and why**, in plain language — not just a diff. ("Added grade-publish endpoint, restricted to `school_admin` role for the requesting user's own `school_id`.")
2. **Every dependency added or updated** — name, version, and why. Verify the package actually exists (real registry listing, real download history) *before* installing — this is the direct defense against package hallucination and slopsquatting.
3. **Anything touching auth, payments, or grade-publishing** is called out as its own high-risk section, not buried in a normal changelog line.
4. **Actual test pass/fail output**, pasted in — not "tests written." Include the adversarial tests specifically (wrong role, expired token, cross-school access attempt) and show they were rejected as expected.
5. **`CHANGES.md`** in the repo accumulates all of this over time — a scannable history, not something that has to be reconstructed from memory later.

Tests should be written to hold up efficiently even at scale (the ~25,000-student target, §3) — no shortcuts that only work at toy data volumes.

---

## 13. Business context (for reference — not code, but explains "why" behind several decisions above)

- **Pricing:** $15/student/year — $10 to the platform, $5 to the school (paid to the school's own mobile money account as a complimentary/incentive fee, not deducted from anything else).
- **Target scale:** ~50 schools × ~500 students (~25,000 students) → roughly $375,000/year total revenue moving through the platform, ~$250,000/year to the platform after hosting.
- **Delivery model:** PWA, not native — avoids App Store / Play Store review cycles entirely, which also plays well with the status-based access control in §6 (a withdrawn student loses access on next load, no store review delay).
- **Pre-launch checklist** (do not skip before any real school onboarding): privacy policy page, terms & conditions page, secrets kept off the frontend, forced HTTPS, cookie consent banner, meta titles/descriptions, social preview image, favicon, sitemap + robots.txt, alt text on images, compressed images, page load speed checked, color contrast fixed, mobile-friendly layout, custom 404 page, no broken links, form validation, spam protection, analytics wired up, one clear call to action per screen.

---

## 14. Build order

1. Multi-tenant schema + auth (staff password login, parent phone+PIN login, GitHub repo set up per §2).
2. Admin web: attendance marking + period lock.
3. Grade entry + deadline lock + missing-submission admin flagging + publish gate (with the state machine and grace-window option from §6).
4. Report generation (period + semester compile).
5. Fee ledger + MTN/Orange Money integration (collect → disburse flow, fee gross-up formula, Pay Now / Pay All UI from §7). Build the shared **audience targeting primitive** (§7) here, since charge batches are its first consumer and events and announcements both reuse it — including grade groups, exclusions, and the mandatory live preview before publish.
6. School calendar & events (§8) — after the ledger, since attached event fees generate charge items rather than having their own payment path.
7. Admin financial intelligence dashboard (§9) — built once real ledger/payment data exists to report on.
8. Parent PWA: attendance/grades/fees/events view, phone+PIN auth flow, multi-child support, the design system in §11.
9. Notification system (§10) — build in this order: (a) the in-app notification centre, since everything writes to it; (b) Web Push with VAPID, including **both** install paths (Android one-tap, iOS guided walkthrough) and the permission-prompt timing; (c) the printable enrollment credential slip in the admin dashboard; (d) SMS for PIN-reset only. WhatsApp is **not** built in v1.
10. Pilot with one school, one grade, one period before wider rollout.

At every step, follow §12's reporting protocol and give §5's security-critical surfaces the scrutiny called for there.
