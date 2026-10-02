import { Router } from "express";
import { z } from "zod";
import type { AppDeps } from "../auth/principal.ts";
import { asyncHandler, badRequest } from "../http.ts";
import { requireAuth, requireRole } from "../middleware/auth.ts";
import { requireSchoolScope } from "../middleware/tenancy.ts";
import {
  approveGrade,
  correctPublishedGrade,
  listStudentGrades,
  missingSubmissions,
  publishGradeCohort,
  setGradeUnderReview,
  submitGrade,
  upsertDraftGrade,
} from "../services/grades.ts";
import { createPeriod, listPeriods, updatePeriod } from "../services/periods.ts";
import { executePromotion, promotionReview } from "../services/promotion.ts";
import { listSectionAttendance, listStudentAttendance, markSectionAttendance } from "../services/attendance.ts";
import { getSchoolSettings, updateSchoolSettings } from "../services/settings.ts";
import {
  activateAcademicYear,
  closeAcademicYear,
  createAcademicYear,
  listAcademicYears,
  updateAcademicYear,
} from "../services/years.ts";

const periodCreateSchema = z.object({
  number: z.number().int().min(1).max(20),
  name: z.string().min(1).optional(),
  startDate: z.string(),
  endDate: z.string(),
  gradeEntryDeadline: z.string(),
  academicYearId: z.string().uuid().optional(),
  type: z.enum(["REGULAR", "SUMMER"]).optional(),
  attendanceCountsTowardGrade: z.boolean().nullable().optional(),
});

const periodUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  gradeEntryDeadline: z.string().optional(),
  attendanceCountsTowardGrade: z.boolean().nullable().optional(),
});

const attendanceMarkSchema = z.object({
  date: z.string(),
  records: z.array(z.object({ studentId: z.string().uuid(), status: z.string() })).min(1),
  reason: z.string().optional(),
});

const yearCreateSchema = z.object({
  label: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
});

const yearUpdateSchema = z.object({
  label: z.string().min(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const yearCloseSchema = z.object({
  override: z.boolean().optional(),
  reason: z.string().optional(),
});

const promotionSchema = z.object({
  sourceYearId: z.string().uuid(),
  sourceSectionId: z.string().uuid(),
  targetYearId: z.string().uuid(),
  defaultTargetSectionId: z.string().uuid(),
  repeatTargetSectionId: z.string().uuid(),
  decisions: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        outcome: z.enum(["PENDING", "PROMOTED", "REPEATING", "GRADUATED", "WITHDRAWN", "TRANSFERRED"]),
        targetSectionId: z.string().uuid().optional(),
      }),
    )
    .min(1),
});

const gradeUpsertSchema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
  assessmentType: z.enum(["QUIZ", "TEST", "HOMEWORK", "EXAM"]),
  sequence: z.number().int().optional(),
  score: z.number(),
  reason: z.string().optional(),
});

const gradeReasonSchema = z.object({
  reason: z.string().optional(),
});

const gradePublishSchema = z
  .object({
    periodId: z.string().uuid(),
    sectionId: z.string().uuid().optional(),
    gradeLevelId: z.string().uuid().optional(),
    studentIds: z.unknown().optional(),
    reason: z.string().optional(),
  })
  .passthrough();

const gradeReviewSchema = z.object({
  underReview: z.boolean(),
});

const gradeCorrectSchema = z.object({
  score: z.number(),
  reason: z.string(),
});

const settingsSchema = z.object({
  gradeCadence: z.string().optional(),
  publishTiming: z.string().optional(),
  publishGraceHours: z.number().int().optional(),
  attendanceVisibleToParents: z.boolean().optional(),
  attendanceCountsTowardGrade: z.boolean().optional(),
});

export function academicRouter(_deps: AppDeps): Router {
  const router = Router();

  router.get(
    "/schools/:schoolId/academic-years",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin", "teacher"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const years = await listAcademicYears(prisma, String(req.params.schoolId));
      res.json({ academicYears: years });
    }),
  );

  router.post(
    "/schools/:schoolId/academic-years",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = yearCreateSchema.parse(req.body);
      const year = await createAcademicYear(prisma, req.auth!, String(req.params.schoolId), body);
      res.status(201).json({ academicYear: year });
    }),
  );

  router.patch(
    "/schools/:schoolId/academic-years/:yearId",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = yearUpdateSchema.parse(req.body);
      const year = await updateAcademicYear(
        prisma,
        req.auth!,
        String(req.params.schoolId),
        String(req.params.yearId),
        body,
      );
      res.json({ academicYear: year });
    }),
  );

  router.post(
    "/schools/:schoolId/academic-years/:yearId/activate",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = yearCloseSchema.parse(req.body ?? {});
      const result = await activateAcademicYear(
        prisma,
        req.auth!,
        String(req.params.schoolId),
        String(req.params.yearId),
        body,
      );
      res.json(result);
    }),
  );

  router.post(
    "/schools/:schoolId/academic-years/:yearId/close",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = yearCloseSchema.parse(req.body ?? {});
      const year = await closeAcademicYear(
        prisma,
        req.auth!,
        String(req.params.schoolId),
        String(req.params.yearId),
        body,
      );
      res.json({ academicYear: year });
    }),
  );

  router.get(
    "/schools/:schoolId/academic-years/:yearId/sections/:sectionId/promotion-review",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const targetYearId = typeof req.query.targetYearId === "string" ? req.query.targetYearId : "";
      if (!targetYearId) throw badRequest("targetYearId query parameter is required.");
      const review = await promotionReview(
        prisma,
        String(req.params.schoolId),
        String(req.params.yearId),
        String(req.params.sectionId),
        targetYearId,
      );
      res.json(review);
    }),
  );

  router.post(
    "/schools/:schoolId/promotions",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = promotionSchema.parse(req.body);
      const result = await executePromotion(prisma, req.auth!, String(req.params.schoolId), body);
      res.json(result);
    }),
  );

  router.get(
    "/schools/:schoolId/periods",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const periods = await listPeriods(prisma, String(req.params.schoolId));
      res.json({ periods });
    }),
  );

  router.post(
    "/schools/:schoolId/periods",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = periodCreateSchema.parse(req.body);
      const period = await createPeriod(prisma, String(req.params.schoolId), body);
      res.status(201).json({ period });
    }),
  );

  router.patch(
    "/schools/:schoolId/periods/:periodId",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = periodUpdateSchema.parse(req.body);
      const period = await updatePeriod(prisma, String(req.params.schoolId), String(req.params.periodId), body);
      res.json({ period });
    }),
  );

  router.get(
    "/schools/:schoolId/settings",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const settings = await getSchoolSettings(prisma, String(req.params.schoolId));
      res.json({ settings });
    }),
  );

  router.patch(
    "/schools/:schoolId/settings",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = settingsSchema.parse(req.body);
      const settings = await updateSchoolSettings(prisma, String(req.params.schoolId), body);
      res.json({ settings });
    }),
  );

  router.post(
    "/schools/:schoolId/sections/:sectionId/attendance",
    requireAuth,
    requireSchoolScope,
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = attendanceMarkSchema.parse(req.body);
      const records = await markSectionAttendance(
        prisma,
        req.auth!,
        String(req.params.schoolId),
        String(req.params.sectionId),
        body,
      );
      res.json({ records });
    }),
  );

  router.get(
    "/schools/:schoolId/sections/:sectionId/attendance",
    requireAuth,
    requireSchoolScope,
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const date = typeof req.query.date === "string" ? req.query.date : "";
      const records = await listSectionAttendance(
        prisma,
        req.auth!,
        String(req.params.schoolId),
        String(req.params.sectionId),
        date,
      );
      res.json({ records });
    }),
  );

  router.post(
    "/schools/:schoolId/grades",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin", "teacher"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = gradeUpsertSchema.parse(req.body);
      const grade = await upsertDraftGrade(prisma, req.auth!, String(req.params.schoolId), body);
      res.status(201).json({ grade });
    }),
  );

  router.post(
    "/schools/:schoolId/grades/:gradeId/submit",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin", "teacher"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = gradeReasonSchema.parse(req.body ?? {});
      const grade = await submitGrade(
        prisma,
        req.auth!,
        String(req.params.schoolId),
        String(req.params.gradeId),
        body.reason,
      );
      res.json({ grade });
    }),
  );

  router.post(
    "/schools/:schoolId/grades/:gradeId/approve",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = gradeReasonSchema.parse(req.body ?? {});
      const grade = await approveGrade(
        prisma,
        req.auth!,
        String(req.params.schoolId),
        String(req.params.gradeId),
        body.reason,
      );
      res.json({ grade });
    }),
  );

  router.post(
    "/schools/:schoolId/grades/publish",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = gradePublishSchema.parse(req.body);
      const result = await publishGradeCohort(prisma, req.auth!, String(req.params.schoolId), body);
      res.json(result);
    }),
  );

  router.post(
    "/schools/:schoolId/grades/:gradeId/under-review",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = gradeReviewSchema.parse(req.body);
      const grade = await setGradeUnderReview(
        prisma,
        req.auth!,
        String(req.params.schoolId),
        String(req.params.gradeId),
        body.underReview,
      );
      res.json({ grade });
    }),
  );

  router.post(
    "/schools/:schoolId/grades/:gradeId/correct",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const body = gradeCorrectSchema.parse(req.body);
      const grade = await correctPublishedGrade(
        prisma,
        req.auth!,
        String(req.params.schoolId),
        String(req.params.gradeId),
        body,
      );
      res.json({ grade });
    }),
  );

  router.get(
    "/schools/:schoolId/periods/:periodId/missing-submissions",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const missing = await missingSubmissions(
        prisma,
        String(req.params.schoolId),
        String(req.params.periodId),
      );
      res.json({ missing });
    }),
  );

  router.get(
    "/schools/:schoolId/students/:studentId/grades",
    requireAuth,
    requireSchoolScope,
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const periodId = typeof req.query.periodId === "string" ? req.query.periodId : undefined;
      const grades = await listStudentGrades(
        prisma,
        req.auth!,
        String(req.params.schoolId),
        String(req.params.studentId),
        periodId,
      );
      res.json({ grades });
    }),
  );

  router.get(
    "/schools/:schoolId/students/:studentId/attendance",
    requireAuth,
    requireSchoolScope,
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const records = await listStudentAttendance(
        prisma,
        req.auth!,
        String(req.params.schoolId),
        String(req.params.studentId),
        from,
        to,
      );
      res.json({ records });
    }),
  );

  return router;
}
