import { rateLimit } from "express-rate-limit";
import type { AppDeps } from "../auth/principal.ts";

const limitedBody = {
  error: { code: "RATE_LIMITED", message: "Too many attempts from this address. Try again later." },
};

export function authRateLimiter(deps: AppDeps) {
  return rateLimit({
    windowMs: deps.config.authRateLimitWindowMs,
    limit: deps.config.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => !deps.config.rateLimitEnabled,
    message: limitedBody,
  });
}

export function apiRateLimiter(deps: AppDeps) {
  return rateLimit({
    windowMs: deps.config.apiRateLimitWindowMs,
    limit: deps.config.apiRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => !deps.config.rateLimitEnabled,
    message: {
      error: { code: "RATE_LIMITED", message: "Too many requests from this address. Try again later." },
    },
  });
}
