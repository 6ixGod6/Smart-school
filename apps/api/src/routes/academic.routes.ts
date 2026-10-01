import { Router } from "express";
import { z } from "zod";
import type { AppDeps } from "../auth/principal.ts";
import { asyncHandler } from "../http.ts";
import { requireAuth, requireRole } from "../middleware/auth.ts";
import { requireSchoolScope } from "../middleware/tenancy.ts";
import { createPeriod, listPeriods, updatePeriod } from "../services/periods.ts";
import { listSectionAttendance, listStudentAttendance, markSectionAttendance } from "../services/attendance.ts";
import { getSchoolSettings, updateSchoolSettings } from "../services/settings.ts";

const periodCreateSchema = z.object({
  number: z.number().int().min(1).max(6),
  name: z.string().min(1).optional(),
  startDate: z.string(),
  endDate: z.string(),
  gradeEntryDeadline: z.string(),
});

const periodUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  gradeEntryDeadline: z.string().optional(),
});

const attendanceMarkSchema = z.object({
  date: z.string(),
  records: z.array(z.object({ studentId: z.string().uuid(), status: z.string() })).min(1),
  reason: z.string().optional(),
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
