import type { NextFunction, Request, Response } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import type { Role } from "@smart-school/shared";
import { loadParentPrincipal, loadStaffPrincipal, type AppDeps } from "../auth/principal.ts";
import { verifyAccessToken } from "../auth/tokens.ts";
import { forbidden, unauthenticated } from "../http.ts";

function depsOf(req: Request): AppDeps {
  return req.app.locals.deps as AppDeps;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.get("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      next(unauthenticated());
      return;
    }
    const { prisma, config } = depsOf(req);
    const claims = verifyAccessToken(token, config);
    const principal =
      claims.kind === "staff"
        ? await loadStaffPrincipal(prisma, claims.sub)
        : await loadParentPrincipal(prisma, claims.sub);
    if (!principal) {
      next(unauthenticated("Account is no longer active."));
      return;
    }
    if (principal.role !== claims.role || principal.schoolId !== claims.schoolId) {
      next(unauthenticated("Token claims are stale. Sign in again."));
      return;
    }
    req.auth = principal;
    next();
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      next(unauthenticated("Access token expired."));
      return;
    }
    if (err instanceof JsonWebTokenError) {
      next(unauthenticated("Invalid access token."));
      return;
    }
    next(err);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(unauthenticated());
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(forbidden("Insufficient role for this action."));
      return;
    }
    next();
  };
}
