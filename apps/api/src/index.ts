import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { createPrisma } from "@smart-school/shared";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

loadEnv({ path: resolve(import.meta.dirname, "../../../.env") });

const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const app = createApp({ prisma, config });

app.listen(config.port, () => {
  console.log(`Smart School API listening on port ${config.port}`);
});
