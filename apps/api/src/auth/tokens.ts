import { createHash, randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type { AccessTokenClaims, PrincipalKind, Role } from "@smart-school/shared";
import type { AppConfig } from "../config.ts";

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
};

export function hashRefreshToken(token: string, pepper: string): string {
  return createHash("sha256").update(`${pepper}:${token}`).digest("hex");
}

export function newRefreshTokenValue(): string {
  return randomBytes(32).toString("base64url");
}

export function newFamilyId(): string {
  return randomUUID();
}

export function signAccessToken(
  claims: Omit<AccessTokenClaims, "typ">,
  config: AppConfig,
  expiresInSeconds = config.accessTokenTtlMinutes * 60,
): string {
  const payload: AccessTokenClaims = { ...claims, typ: "access" };
  return jwt.sign(payload, config.jwtAccessSecret, {
    algorithm: "HS256",
    expiresIn: `${expiresInSeconds}s`,
  });
}

export function verifyAccessToken(token: string, config: AppConfig): AccessTokenClaims {
  const decoded = jwt.verify(token, config.jwtAccessSecret, {
    algorithms: ["HS256"],
    clockTimestamp: Math.floor(Date.now() / 1000),
  });
  if (typeof decoded === "string" || decoded.typ !== "access" || !decoded.sub || !decoded.role || !decoded.kind) {
    throw new Error("Invalid access token payload");
  }
  return {
    sub: decoded.sub,
    typ: "access",
    role: decoded.role as Role,
    kind: decoded.kind as PrincipalKind,
    schoolId: typeof decoded.schoolId === "string" ? decoded.schoolId : decoded.schoolId === null ? null : null,
  };
}

export function refreshTtlDays(kind: PrincipalKind, config: AppConfig): number {
  return kind === "parent" ? config.parentRefreshTtlDays : config.staffRefreshTtlDays;
}
