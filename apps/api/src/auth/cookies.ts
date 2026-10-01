import type { Request, Response } from "express";
import { refreshTtlDays, type TokenPair } from "./tokens.ts";
import type { AppConfig } from "../config.ts";
import type { PrincipalKind } from "@smart-school/shared";

export const REFRESH_COOKIE_NAME = "refresh_token";
/** Scoped to auth routes so /v1/auth/refresh and /v1/auth/logout receive it, not attendance/fees. */
export const REFRESH_COOKIE_PATH = "/v1/auth";

export function refreshCookieMaxAgeMs(kind: PrincipalKind, config: AppConfig): number {
  return refreshTtlDays(kind, config) * 24 * 60 * 60 * 1000;
}

export function setRefreshCookie(res: Response, token: string, maxAgeMs: number, secure: boolean): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
  });
}

export function clearRefreshCookie(res: Response, secure: boolean): void {
  res.cookie(REFRESH_COOKIE_NAME, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
  });
}

export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== REFRESH_COOKIE_NAME) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function publicSession(result: TokenPair & { user: unknown }): Omit<TokenPair, "refreshToken"> & { user: unknown } {
  const { refreshToken: _ignored, ...rest } = result;
  return rest;
}
