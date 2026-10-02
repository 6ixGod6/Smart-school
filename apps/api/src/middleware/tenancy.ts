import type { NextFunction, Request, Response } from "express";
import type { AuthPrincipal } from "@smart-school/shared";
import { forbidden, notFound, unauthenticated } from "../http.ts";

/** Every school-scoped route must confirm the path school matches the token. Super-admin may pass any school id. */
export function requireSchoolScope(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(unauthenticated());
    return;
  }
  const schoolId = req.params.schoolId;
  if (!schoolId) {
    next(forbidden("Missing school id."));
    return;
  }
  if (req.auth.role === "super_admin") {
    next();
    return;
  }
  if (!req.auth.schoolId || req.auth.schoolId !== schoolId) {
    next(forbidden("Cross-school access is not allowed."));
    return;
  }
  next();
}

export function assertTeacherAssignedToSection(auth: AuthPrincipal, sectionId: string): void {
  if (auth.role === "school_admin" || auth.role === "super_admin") return;
  if (auth.role !== "teacher") {
    throw forbidden("Insufficient role for this action.");
  }
  if (!auth.sectionIds.includes(sectionId)) {
    throw forbidden("You are not assigned to this section.");
  }
}

export function assertTeacherAssignedToSubject(auth: AuthPrincipal, subjectId: string): void {
  if (auth.role === "school_admin" || auth.role === "super_admin") return;
  if (auth.role !== "teacher") {
    throw forbidden("Insufficient role for this action.");
  }
  if (!auth.subjectIds.includes(subjectId)) {
    throw forbidden("You are not assigned to this subject.");
  }
}

/** Parents must not learn that a student exists at another family or a withdrawn child is still on file. */
export function parentMaySeeStudent(auth: AuthPrincipal, studentId: string, status: string): void {
  if (!auth.studentIds.includes(studentId) || (status !== "ACTIVE" && status !== "INACTIVE")) {
    throw notFound();
  }
}
