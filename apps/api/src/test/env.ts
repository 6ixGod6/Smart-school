import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../../..");
loadEnv({ path: resolve(repoRoot, ".env") });
process.env.NODE_ENV = "test";
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
