import { Router } from "express";
import type { AppDeps } from "../auth/principal.ts";
import { asyncHandler, forbidden, notFound } from "../http.ts";
import { requireAuth, requireRole } from "../middleware/auth.ts";
import {
  assertTeacherAssignedToSection,
  parentMaySeeStudent,
  requireSchoolScope,
} from "../middleware/tenancy.ts";

/** Minimal school-scoped resources so authz can be tested against real rows. Not the product UI. */
export function resourceRouter(_deps: AppDeps): Router {
  const router = Router();

  router.get(
    "/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json({ user: req.auth });
    }),
  );

  router.get(
    "/schools/:schoolId/staff",
    requireAuth,
    requireSchoolScope,
    requireRole("school_admin", "super_admin"),
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const schoolId = String(req.params.schoolId);
      const staff = await prisma.staffUser.findMany({
        where: { schoolId },
        select: { id: true, email: true, username: true, role: true, isActive: true, schoolId: true },
        orderBy: { email: "asc" },
      });
      res.json({ staff });
    }),
  );

  router.get(
    "/schools/:schoolId/students/:studentId",
    requireAuth,
    requireSchoolScope,
    asyncHandler(async (req, res) => {
      const { prisma } = req.app.locals.deps as AppDeps;
      const schoolId = String(req.params.schoolId);
      const studentId = String(req.params.studentId);
      const student = await prisma.student.findFirst({
        where: { id: studentId, schoolId },
      });
      if (!student) throw notFound();

      const auth = req.auth!;
      if (auth.role === "parent") {
        parentMaySeeStudent(auth, student.id, student.status);
      } else if (auth.role === "teacher") {
        assertTeacherAssignedToSection(auth, student.sectionId);
      } else if (auth.role !== "school_admin" && auth.role !== "super_admin") {
        throw forbidden();
      }

      res.json({
        student: {
          id: student.id,
          schoolId: student.schoolId,
          studentCode: student.studentCode,
          sectionId: student.sectionId,
          name: student.name,
          status: student.status,
        },
      });
    }),
  );

  router.get(
    "/schools/:schoolId/sections/:sectionId/students",
    requireAuth,
    requireSchoolScope,
    asyncHandler(async (req, res) => {
      const auth = req.auth!;
      const schoolId = String(req.params.schoolId);
      const sectionId = String(req.params.sectionId);
      if (auth.role === "parent") throw forbidden("Parents cannot list a section.");
      assertTeacherAssignedToSection(auth, sectionId);

      const { prisma } = req.app.locals.deps as AppDeps;
      const section = await prisma.section.findFirst({
        where: { id: sectionId, schoolId },
      });
      if (!section) throw notFound();

      const students = await prisma.student.findMany({
        where: { sectionId: section.id, schoolId: section.schoolId },
        select: { id: true, name: true, studentCode: true, status: true, sectionId: true, schoolId: true },
        orderBy: { name: "asc" },
      });
      res.json({ students });
    }),
  );

  return router;
}
