import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  REFRESH_TOKEN_PEPPER: z.string().min(32),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  PARENT_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(60),
  STAFF_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  PARENT_PHONE_IP_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(20),
  PARENT_PHONE_IP_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(40),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  jwtAccessSecret: string;
  refreshTokenPepper: string;
  accessTokenTtlMinutes: number;
  parentRefreshTtlDays: number;
  staffRefreshTtlDays: number;
  bcryptRounds: number;
  maxFailedLoginAttempts: number;
  loginLockoutMinutes: number;
  parentPhoneIpMaxFailedAttempts: number;
  parentPhoneIpLockoutMinutes: number;
  authRateLimitWindowMs: number;
  authRateLimitMax: number;
  apiRateLimitWindowMs: number;
  apiRateLimitMax: number;
  corsOrigins: string[];
  rateLimitEnabled: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(env);
  const isTest = parsed.NODE_ENV === "test";
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    jwtAccessSecret: parsed.JWT_ACCESS_SECRET,
    refreshTokenPepper: parsed.REFRESH_TOKEN_PEPPER,
    accessTokenTtlMinutes: parsed.ACCESS_TOKEN_TTL_MINUTES,
    parentRefreshTtlDays: parsed.PARENT_REFRESH_TOKEN_TTL_DAYS,
    staffRefreshTtlDays: parsed.STAFF_REFRESH_TOKEN_TTL_DAYS,
    bcryptRounds: isTest ? 4 : parsed.BCRYPT_ROUNDS,
    maxFailedLoginAttempts: parsed.MAX_FAILED_LOGIN_ATTEMPTS,
    loginLockoutMinutes: parsed.LOGIN_LOCKOUT_MINUTES,
    parentPhoneIpMaxFailedAttempts: parsed.PARENT_PHONE_IP_MAX_FAILED_ATTEMPTS,
    parentPhoneIpLockoutMinutes: parsed.PARENT_PHONE_IP_LOCKOUT_MINUTES,
    authRateLimitWindowMs: parsed.AUTH_RATE_LIMIT_WINDOW_MS,
    authRateLimitMax: parsed.AUTH_RATE_LIMIT_MAX,
    apiRateLimitWindowMs: parsed.API_RATE_LIMIT_WINDOW_MS,
    apiRateLimitMax: parsed.API_RATE_LIMIT_MAX,
    corsOrigins: parsed.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    rateLimitEnabled: !isTest,
  };
}
