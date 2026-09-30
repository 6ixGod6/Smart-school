import { config as loadEnv } from "dotenv";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

export default async function globalSetup(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, "../../../..");
  loadEnv({ path: resolve(repoRoot, ".env") });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error("DATABASE_URL_TEST is required to run API tests.");
  }
  execSync("pnpm db:migrate:deploy", {
    cwd: resolve(repoRoot, "packages/shared"),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
