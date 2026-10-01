import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { loginParent, loginStaff, logout, refreshSession, setParentPin } from "../auth/service.ts";
import {
  clearRefreshCookie,
  publicSession,
  readRefreshCookie,
  refreshCookieMaxAgeMs,
  setRefreshCookie,
} from "../auth/cookies.ts";
import type { AppDeps } from "../auth/principal.ts";
import { asyncHandler, unauthenticated } from "../http.ts";
import { requireAuth } from "../middleware/auth.ts";

const staffLoginSchema = z
  .object({
    email: z.string().email().optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1),
  })
  .refine((body) => Boolean(body.email || body.username), {
    message: "email or username is required",
  });

const parentLoginSchema = z.object({
  phone: z.string().min(8),
  pin: z.string().min(1),
  schoolId: z.string().uuid().optional(),
});

const pinSchema = z.object({
  currentPin: z.string().min(1),
  newPin: z.string().min(1),
});

function cookieSecure(deps: AppDeps): boolean {
  return deps.config.nodeEnv === "production";
}

export function authRouter(deps: AppDeps): Router {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => !deps.config.rateLimitEnabled,
    message: { error: { code: "RATE_LIMITED", message: "Too many login attempts from this address." } },
  });

  router.post(
    "/staff/login",
    loginLimiter,
    asyncHandler(async (req, res) => {
      const body = staffLoginSchema.parse(req.body);
      const result = await loginStaff(deps, body, req.get("user-agent") ?? undefined);
      setRefreshCookie(res, result.refreshToken, refreshCookieMaxAgeMs(result.user.kind, deps.config), cookieSecure(deps));
      res.json(publicSession(result));
    }),
  );

  router.post(
    "/parent/login",
    loginLimiter,
    asyncHandler(async (req, res) => {
      const body = parentLoginSchema.parse(req.body);
      const result = await loginParent(deps, body, req.get("user-agent") ?? undefined);
      setRefreshCookie(res, result.refreshToken, refreshCookieMaxAgeMs(result.user.kind, deps.config), cookieSecure(deps));
      res.json(publicSession(result));
    }),
  );

  router.post(
    "/refresh",
    asyncHandler(async (req, res) => {
      const token = readRefreshCookie(req);
      if (!token) throw unauthenticated("Invalid refresh token.");
      const result = await refreshSession(deps, token, req.get("user-agent") ?? undefined);
      setRefreshCookie(res, result.refreshToken, refreshCookieMaxAgeMs(result.user.kind, deps.config), cookieSecure(deps));
      res.json(publicSession(result));
    }),
  );

  router.post(
    "/logout",
    asyncHandler(async (req, res) => {
      const token = readRefreshCookie(req);
      if (token) await logout(deps, token);
      clearRefreshCookie(res, cookieSecure(deps));
      res.status(204).send();
    }),
  );

  router.post(
    "/parent/pin",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.auth || req.auth.kind !== "parent") {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "Only a parent can change a PIN." } });
        return;
      }
      const body = pinSchema.parse(req.body);
      await setParentPin(deps, req.auth.id, body);
      res.status(204).send();
    }),
  );

  return router;
}
