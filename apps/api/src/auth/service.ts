import type { PrismaClient } from "@smart-school/shared";
import type { AppConfig } from "../config.ts";
import { writeAudit } from "./audit.ts";
import { dummyVerify, hashSecret, isSixDigitPin, verifySecret } from "./passwords.ts";
import { loadParentPrincipal, loadStaffPrincipal, staffRoleToClaim, type AppDeps } from "./principal.ts";
import {
  hashRefreshToken,
  newFamilyId,
  newRefreshTokenValue,
  refreshTtlDays,
  signAccessToken,
  type TokenPair,
} from "./tokens.ts";
import { AppError, conflict, forbidden, tooMany, unauthenticated } from "../http.ts";

const LOGIN_FAILED_MESSAGE = "Invalid credentials.";

type SessionUser = {
  id: string;
  role: "parent" | "teacher" | "school_admin" | "super_admin";
  kind: "staff" | "parent";
  schoolId: string | null;
  email?: string;
  phone?: string;
  mustChangePin?: boolean;
};

export type AuthSuccess = TokenPair & { user: SessionUser };

function expiresAtFromDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function issueSession(
  prisma: PrismaClient,
  config: AppConfig,
  user: SessionUser,
  userAgent: string | undefined,
  familyId = newFamilyId(),
): Promise<AuthSuccess> {
  const refreshToken = newRefreshTokenValue();
  const tokenHash = hashRefreshToken(refreshToken, config.refreshTokenPepper);
  const ttlDays = refreshTtlDays(user.kind, config);
  await prisma.refreshToken.create({
    data: {
      tokenHash,
      familyId,
      staffUserId: user.kind === "staff" ? user.id : null,
      parentId: user.kind === "parent" ? user.id : null,
      expiresAt: expiresAtFromDays(ttlDays),
      userAgent: userAgent ?? null,
    },
  });
  const accessToken = signAccessToken(
    { sub: user.id, role: user.role, kind: user.kind, schoolId: user.schoolId },
    config,
  );
  return {
    accessToken,
    refreshToken,
    expiresInSeconds: config.accessTokenTtlMinutes * 60,
    user,
  };
}

async function failStaffLogin(
  prisma: PrismaClient,
  config: AppConfig,
  staffId: string | null,
  currentAttempts: number,
): Promise<never> {
  if (staffId) {
    const attempts = currentAttempts + 1;
    const locked = attempts >= config.maxFailedLoginAttempts;
    await prisma.staffUser.update({
      where: { id: staffId },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: locked ? new Date(Date.now() + config.loginLockoutMinutes * 60_000) : null,
      },
    });
    await writeAudit(prisma, {
      actorStaffId: staffId,
      action: locked ? "STAFF_LOGIN_LOCKED" : "STAFF_LOGIN_FAILED",
      entityType: "staff_user",
      entityId: staffId,
      metadata: { attempts },
    });
  }
  throw unauthenticated(LOGIN_FAILED_MESSAGE);
}

async function failParentLogin(
  prisma: PrismaClient,
  config: AppConfig,
  parentId: string | null,
  schoolId: string | null,
  currentAttempts: number,
): Promise<never> {
  if (parentId) {
    const attempts = currentAttempts + 1;
    const locked = attempts >= config.maxFailedLoginAttempts;
    await prisma.parent.update({
      where: { id: parentId },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: locked ? new Date(Date.now() + config.loginLockoutMinutes * 60_000) : null,
      },
    });
    await writeAudit(prisma, {
      schoolId,
      actorParentId: parentId,
      action: locked ? "PARENT_LOGIN_LOCKED" : "PARENT_LOGIN_FAILED",
      entityType: "parent",
      entityId: parentId,
      metadata: { attempts },
    });
  }
  throw unauthenticated(LOGIN_FAILED_MESSAGE);
}

function assertNotLocked(lockedUntil: Date | null): void {
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    throw tooMany("LOCKED_OUT", "Too many failed attempts. Try again later.");
  }
}

export async function loginStaff(
  deps: AppDeps,
  input: { email?: string; username?: string; password: string },
  userAgent: string | undefined,
): Promise<AuthSuccess> {
  const { prisma, config } = deps;
  const email = input.email?.trim().toLowerCase();
  const username = input.username?.trim();
  const staff = email
    ? await prisma.staffUser.findUnique({ where: { email } })
    : username
      ? await prisma.staffUser.findUnique({ where: { username } })
      : null;

  if (!staff) {
    await dummyVerify(input.password, config.bcryptRounds);
    throw unauthenticated(LOGIN_FAILED_MESSAGE);
  }
  assertNotLocked(staff.lockedUntil);
  const ok = await verifySecret(input.password, staff.passwordHash);
  if (!ok) {
    await failStaffLogin(prisma, config, staff.id, staff.failedLoginAttempts);
  }
  if (!staff.isActive) {
    throw forbidden("This account is disabled.");
  }
  await prisma.staffUser.update({
    where: { id: staff.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
  const user: SessionUser = {
    id: staff.id,
    role: staffRoleToClaim(staff.role),
    kind: "staff",
    schoolId: staff.schoolId,
    email: staff.email,
  };
  const session = await issueSession(prisma, config, user, userAgent);
  await writeAudit(prisma, {
    schoolId: staff.schoolId,
    actorStaffId: staff.id,
    action: "STAFF_LOGIN_SUCCEEDED",
    entityType: "staff_user",
    entityId: staff.id,
  });
  return session;
}

export async function loginParent(
  deps: AppDeps,
  input: { phone: string; pin: string; schoolId?: string },
  userAgent: string | undefined,
): Promise<AuthSuccess> {
  const { prisma, config } = deps;
  const phone = input.phone.trim();
  if (!isSixDigitPin(input.pin)) {
    await dummyVerify(input.pin, config.bcryptRounds);
    throw unauthenticated(LOGIN_FAILED_MESSAGE);
  }

  const matches = await prisma.parent.findMany({
    where: { phone },
    include: { school: { select: { id: true, name: true } } },
  });
  if (matches.length === 0) {
    await dummyVerify(input.pin, config.bcryptRounds);
    throw unauthenticated(LOGIN_FAILED_MESSAGE);
  }

  if (input.schoolId) {
    const parent = matches.find((row) => row.schoolId === input.schoolId);
    if (!parent) {
      await dummyVerify(input.pin, config.bcryptRounds);
      throw unauthenticated(LOGIN_FAILED_MESSAGE);
    }
    return completeParentLogin(prisma, config, parent, input.pin, userAgent);
  }

  if (matches.length === 1) {
    return completeParentLogin(prisma, config, matches[0]!, input.pin, userAgent);
  }

  // Multi-school: prove the PIN first. Never 409 before a correct PIN.
  // A typo must not increment lockout on every school this phone belongs to;
  // we only count failures against a row once the caller has named that school
  // (the schoolId branch above) or when the phone maps to a single account.
  const pinMatches: typeof matches = [];
  for (const row of matches) {
    if (await verifySecret(input.pin, row.pinHash)) {
      pinMatches.push(row);
    }
  }
  if (pinMatches.length === 0) {
    throw unauthenticated(LOGIN_FAILED_MESSAGE);
  }

  const unlocked = pinMatches.filter((row) => !(row.lockedUntil && row.lockedUntil.getTime() > Date.now()));
  if (unlocked.length === 0) {
    throw tooMany("LOCKED_OUT", "Too many failed attempts. Try again later.");
  }
  if (unlocked.length === 1) {
    return completeParentLogin(prisma, config, unlocked[0]!, input.pin, userAgent, true);
  }

  throw conflict("SCHOOL_SELECTION_REQUIRED", "This phone is registered at more than one school.", {
    schools: unlocked.map((row) => ({ id: row.school.id, name: row.school.name })),
  });
}

async function completeParentLogin(
  prisma: PrismaClient,
  config: AppConfig,
  parent: {
    id: string;
    schoolId: string;
    phone: string;
    pinHash: string;
    mustChangePin: boolean;
    failedLoginAttempts: number;
    lockedUntil: Date | null;
  },
  pin: string,
  userAgent: string | undefined,
  pinAlreadyVerified = false,
): Promise<AuthSuccess> {
  assertNotLocked(parent.lockedUntil);
  const ok = pinAlreadyVerified ? true : await verifySecret(pin, parent.pinHash);
  if (!ok) {
    await failParentLogin(prisma, config, parent.id, parent.schoolId, parent.failedLoginAttempts);
  }
  await prisma.parent.update({
    where: { id: parent.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
  const user: SessionUser = {
    id: parent.id,
    role: "parent",
    kind: "parent",
    schoolId: parent.schoolId,
    phone: parent.phone,
    mustChangePin: parent.mustChangePin,
  };
  const session = await issueSession(prisma, config, user, userAgent);
  await writeAudit(prisma, {
    schoolId: parent.schoolId,
    actorParentId: parent.id,
    action: "PARENT_LOGIN_SUCCEEDED",
    entityType: "parent",
    entityId: parent.id,
  });
  return session;
}

export async function refreshSession(deps: AppDeps, refreshToken: string, userAgent: string | undefined): Promise<AuthSuccess> {
  const { prisma, config } = deps;
  const tokenHash = hashRefreshToken(refreshToken, config.refreshTokenPepper);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing) {
    throw unauthenticated("Invalid refresh token.");
  }
  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit(prisma, {
      actorStaffId: existing.staffUserId,
      actorParentId: existing.parentId,
      action: "REFRESH_REUSE_DETECTED",
      entityType: "refresh_token",
      entityId: existing.familyId,
    });
    throw unauthenticated("Refresh token reuse detected. Sign in again.");
  }
  if (existing.expiresAt.getTime() <= Date.now()) {
    throw unauthenticated("Refresh token expired.");
  }

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });

  let user: SessionUser;
  if (existing.staffUserId) {
    const principal = await loadStaffPrincipal(prisma, existing.staffUserId);
    if (!principal) throw unauthenticated("Account is no longer active.");
    user = {
      id: principal.id,
      role: principal.role,
      kind: "staff",
      schoolId: principal.schoolId,
      email: principal.email,
    };
  } else if (existing.parentId) {
    const principal = await loadParentPrincipal(prisma, existing.parentId);
    if (!principal) throw unauthenticated("Account is no longer active.");
    user = {
      id: principal.id,
      role: "parent",
      kind: "parent",
      schoolId: principal.schoolId,
      phone: principal.phone,
      mustChangePin: principal.mustChangePin,
    };
  } else {
    throw unauthenticated("Invalid refresh token.");
  }

  const session = await issueSession(prisma, config, user, userAgent, existing.familyId);
  return session;
}

export async function logout(deps: AppDeps, refreshToken: string): Promise<void> {
  const { prisma, config } = deps;
  const tokenHash = hashRefreshToken(refreshToken, config.refreshTokenPepper);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing || existing.revokedAt) return;
  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });
}

export async function setParentPin(
  deps: AppDeps,
  parentId: string,
  input: { currentPin: string; newPin: string },
): Promise<void> {
  const { prisma, config } = deps;
  if (!isSixDigitPin(input.currentPin) || !isSixDigitPin(input.newPin)) {
    throw new AppError(400, "VALIDATION_ERROR", "PIN must be exactly 6 digits.");
  }
  const parent = await prisma.parent.findUnique({ where: { id: parentId } });
  if (!parent) throw unauthenticated();
  const ok = await verifySecret(input.currentPin, parent.pinHash);
  if (!ok) throw unauthenticated("Current PIN is incorrect.");
  const pinHash = await hashSecret(input.newPin, config.bcryptRounds);
  await prisma.parent.update({
    where: { id: parent.id },
    data: { pinHash, mustChangePin: false },
  });
  await writeAudit(prisma, {
    schoolId: parent.schoolId,
    actorParentId: parent.id,
    action: "PARENT_PIN_CHANGED",
    entityType: "parent",
    entityId: parent.id,
  });
}
