import type { Prisma, PrismaClient } from "@smart-school/shared";

export type AuditInput = {
  schoolId?: string | null;
  actorStaffId?: string | null;
  actorParentId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeAudit(
  prisma: { auditLog: { create: PrismaClient["auditLog"]["create"] } },
  input: AuditInput,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      schoolId: input.schoolId ?? null,
      actorStaffId: input.actorStaffId ?? null,
      actorParentId: input.actorParentId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
