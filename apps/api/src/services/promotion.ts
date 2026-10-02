import type { PrismaClient } from "@smart-school/shared";
import type { AuthPrincipal } from "@smart-school/shared";
import { writeAudit } from "../auth/audit.ts";
import { badRequest, notFound } from "../http.ts";
import { pendingEnrollmentCount } from "./years.ts";

const OUTCOMES = new Set(["PENDING", "PROMOTED", "REPEATING", "GRADUATED", "WITHDRAWN", "TRANSFERRED"]);

type Outcome = "PENDING" | "PROMOTED" | "REPEATING" | "GRADUATED" | "WITHDRAWN" | "TRANSFERRED";

export type PromotionDecision = {
  studentId: string;
  outcome: string;
  targetSectionId?: string;
};

export type PromotionResult = {
  applied: Array<{ studentId: string; outcome: Outcome; createdEnrollmentId: string | null }>;
  skipped: Array<{ studentId: string; reason: string }>;
  deferred: Array<{ studentId: string }>;
};

function parseOutcome(value: string): Outcome {
  if (!OUTCOMES.has(value)) {
    throw badRequest("outcome must be PENDING, PROMOTED, REPEATING, GRADUATED, WITHDRAWN, or TRANSFERRED.");
  }
  return value as Outcome;
}

function studentStatusFor(outcome: Outcome): "GRADUATED" | "WITHDRAWN" | null {
  if (outcome === "GRADUATED") return "GRADUATED";
  if (outcome === "WITHDRAWN" || outcome === "TRANSFERRED") return "WITHDRAWN";
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 6 && current; i += 1) {
    if (typeof current === "object" && current && "code" in current) {
      const code = String((current as { code: unknown }).code);
      if (code === "P2002" || code === "23505") return true;
    }
    if (current instanceof Error && /\b23505\b/.test(current.message)) return true;
    current =
      typeof current === "object" && current && "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
  }
  return false;
}

/** Savepoint name from the loop index only — never from a user-supplied id. */
function savepointName(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("savepoint index must be a non-negative integer");
  }
  return `sp_${index}`;
}

type PromotionReview = {
  sourceYear: { id: string; label: string; status: "PLANNED" | "ACTIVE" | "CLOSED" };
  targetYear: { id: string; label: string; status: "PLANNED" | "ACTIVE" | "CLOSED" };
  section: { id: string; name: string; gradeLevelId: string };
  pendingInYear: number;
  students: Array<{
    id: string;
    name: string;
    studentCode: string;
    status: "ACTIVE" | "WITHDRAWN" | "GRADUATED" | "INACTIVE";
    enrollment: { id: string; academicYearId: string; sectionId: string; outcome: Outcome };
    hasTargetEnrollment: boolean;
    targetEnrollment: { id: string; studentId: string; sectionId: string } | null;
  }>;
};

export async function promotionReview(
  prisma: PrismaClient,
  schoolId: string,
  sourceYearId: string,
  sectionId: string,
  targetYearId: string,
): Promise<PromotionReview> {
  const sourceYear = await prisma.academicYear.findFirst({ where: { id: sourceYearId, schoolId } });
  if (!sourceYear) throw notFound();
  const targetYear = await prisma.academicYear.findFirst({ where: { id: targetYearId, schoolId } });
  if (!targetYear) throw notFound();
  const section = await prisma.section.findFirst({ where: { id: sectionId, schoolId } });
  if (!section) throw notFound();

  const enrollments = await prisma.enrollment.findMany({
    where: { schoolId, academicYearId: sourceYearId, sectionId },
    include: {
      student: { select: { id: true, name: true, studentCode: true, status: true } },
    },
    orderBy: { student: { name: "asc" } },
  });
  const studentIds = enrollments.map((row) => row.studentId);
  const targetRows = studentIds.length
    ? await prisma.enrollment.findMany({
        where: { schoolId, academicYearId: targetYearId, studentId: { in: studentIds } },
        select: { id: true, studentId: true, sectionId: true },
      })
    : [];
  const targetByStudent = new Map(targetRows.map((row) => [row.studentId, row]));
  const pendingInYear = await pendingEnrollmentCount(prisma, schoolId, sourceYearId);

  return {
    sourceYear: { id: sourceYear.id, label: sourceYear.label, status: sourceYear.status },
    targetYear: { id: targetYear.id, label: targetYear.label, status: targetYear.status },
    section: { id: section.id, name: section.name, gradeLevelId: section.gradeLevelId },
    pendingInYear,
    students: enrollments.map((row) => {
      const target = targetByStudent.get(row.studentId);
      return {
        id: row.student.id,
        name: row.student.name,
        studentCode: row.student.studentCode,
        status: row.student.status,
        enrollment: {
          id: row.id,
          academicYearId: row.academicYearId,
          sectionId: row.sectionId,
          outcome: row.outcome,
        },
        hasTargetEnrollment: Boolean(target),
        targetEnrollment: target ?? null,
      };
    }),
  };
}

export async function executePromotion(
  prisma: PrismaClient,
  auth: AuthPrincipal,
  schoolId: string,
  input: {
    sourceYearId: string;
    sourceSectionId: string;
    targetYearId: string;
    defaultTargetSectionId: string;
    repeatTargetSectionId: string;
    decisions: PromotionDecision[];
  },
): Promise<PromotionResult> {
  if (!Array.isArray(input.decisions) || input.decisions.length === 0) {
    throw badRequest("decisions must be a non-empty list.");
  }
  const seen = new Set<string>();
  const decisions = input.decisions.map((row) => {
    if (seen.has(row.studentId)) {
      throw badRequest("A student cannot appear twice in one promotion request.");
    }
    seen.add(row.studentId);
    return { studentId: row.studentId, outcome: parseOutcome(row.outcome), targetSectionId: row.targetSectionId };
  });

  const sourceYear = await prisma.academicYear.findFirst({ where: { id: input.sourceYearId, schoolId } });
  if (!sourceYear) throw notFound();
  const targetYear = await prisma.academicYear.findFirst({ where: { id: input.targetYearId, schoolId } });
  if (!targetYear) throw notFound();
  if (targetYear.id === sourceYear.id) {
    throw badRequest("targetYearId must be different from sourceYearId.");
  }
  if (targetYear.status === "CLOSED") {
    throw badRequest("Cannot create enrollments in a closed academic year.");
  }

  const sourceSection = await prisma.section.findFirst({ where: { id: input.sourceSectionId, schoolId } });
  if (!sourceSection) throw notFound();
  const defaultTarget = await prisma.section.findFirst({ where: { id: input.defaultTargetSectionId, schoolId } });
  if (!defaultTarget) throw notFound();
  const repeatTarget = await prisma.section.findFirst({ where: { id: input.repeatTargetSectionId, schoolId } });
  if (!repeatTarget) throw notFound();
  if (repeatTarget.gradeLevelId !== sourceSection.gradeLevelId) {
    throw badRequest("repeatTargetSectionId must be in the same grade level as the source section.");
  }

  const overrideIds = [
    ...new Set(decisions.map((row) => row.targetSectionId).filter((id): id is string => Boolean(id))),
  ];
  const overrides = overrideIds.length
    ? await prisma.section.findMany({ where: { schoolId, id: { in: overrideIds } } })
    : [];
  const overrideById = new Map(overrides.map((row) => [row.id, row]));
  for (const id of overrideIds) {
    if (!overrideById.has(id)) throw notFound();
  }

  const studentIds = decisions.map((row) => row.studentId);
  const sourceEnrollments = await prisma.enrollment.findMany({
    where: {
      schoolId,
      academicYearId: sourceYear.id,
      sectionId: sourceSection.id,
      studentId: { in: studentIds },
    },
    include: { student: { select: { studentCode: true } } },
  });
  const sourceByStudent = new Map(sourceEnrollments.map((row) => [row.studentId, row]));
  for (const row of decisions) {
    if (!sourceByStudent.has(row.studentId)) {
      throw badRequest("Every student in the request must be enrolled in the source section for that year.");
    }
    if (row.outcome === "REPEATING") {
      const destId = row.targetSectionId ?? repeatTarget.id;
      const dest = destId === repeatTarget.id ? repeatTarget : overrideById.get(destId);
      if (!dest || dest.gradeLevelId !== sourceSection.gradeLevelId) {
        throw badRequest("A repeating student must stay in the same grade level.");
      }
    }
  }

  return prisma.$transaction(
    async (tx) => {
      const applied: PromotionResult["applied"] = [];
      const skipped: PromotionResult["skipped"] = [];
      const deferred: PromotionResult["deferred"] = [];
      const knownTargets = await tx.enrollment.findMany({
        where: { schoolId, academicYearId: targetYear.id, studentId: { in: studentIds } },
        select: { studentId: true },
      });
      const alreadyInTarget = new Set(knownTargets.map((row) => row.studentId));

      for (let i = 0; i < decisions.length; i += 1) {
        const row = decisions[i]!;
        if (row.outcome === "PENDING") {
          deferred.push({ studentId: row.studentId });
          continue;
        }

        const source = sourceByStudent.get(row.studentId)!;
        if (alreadyInTarget.has(row.studentId)) {
          skipped.push({ studentId: row.studentId, reason: "already_enrolled_in_target_year" });
          continue;
        }
        if (source.outcome !== "PENDING") {
          skipped.push({ studentId: row.studentId, reason: "outcome_already_set" });
          continue;
        }

        const sp = savepointName(i);
        await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`);
        try {
          let createdEnrollmentId: string | null = null;
          if (row.outcome === "PROMOTED" || row.outcome === "REPEATING") {
            const sectionId =
              row.targetSectionId ??
              (row.outcome === "REPEATING" ? repeatTarget.id : defaultTarget.id);
            const created = await tx.enrollment.create({
              data: {
                schoolId,
                studentId: row.studentId,
                academicYearId: targetYear.id,
                sectionId,
                outcome: "PENDING",
              },
            });
            createdEnrollmentId = created.id;
            alreadyInTarget.add(row.studentId);
          }

          await tx.enrollment.update({
            where: { id: source.id },
            data: {
              outcome: row.outcome,
              outcomeSetAt: new Date(),
              outcomeSetByStaffId: auth.id,
            },
          });

          const nextStatus = studentStatusFor(row.outcome);
          if (nextStatus) {
            await tx.student.update({
              where: { id: row.studentId },
              data: { status: nextStatus },
            });
          }

          await writeAudit(tx, {
            schoolId,
            actorStaffId: auth.id,
            action: "ENROLLMENT_OUTCOME_SET",
            entityType: "enrollment",
            entityId: source.id,
            metadata: {
              studentId: row.studentId,
              studentCode: source.student.studentCode,
              oldOutcome: source.outcome,
              newOutcome: row.outcome,
              createdEnrollmentId,
              sourceYearId: sourceYear.id,
              targetYearId: targetYear.id,
            },
          });

          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
          applied.push({ studentId: row.studentId, outcome: row.outcome, createdEnrollmentId });
        } catch (err) {
          if (isUniqueViolation(err)) {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
            skipped.push({ studentId: row.studentId, reason: "concurrent_modification" });
            continue;
          }
          throw err;
        }
      }

      return { applied, skipped, deferred };
    },
    { timeout: 20_000 },
  );
}
