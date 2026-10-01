import cors from "cors";
import express from "express";
import helmet from "helmet";
import type { AppDeps } from "./auth/principal.ts";
import { errorHandler } from "./middleware/errorHandler.ts";
import { apiRateLimiter } from "./middleware/rateLimit.ts";
import { academicRouter } from "./routes/academic.routes.ts";
import { authRouter } from "./routes/auth.routes.ts";
import { resourceRouter } from "./routes/resource.routes.ts";

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.locals.deps = deps;
  app.disable("x-powered-by");
  if (deps.config.nodeEnv === "production") {
    app.set("trust proxy", 1);
  }
  app.use(helmet());
  app.use(cors({ origin: deps.config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/v1", apiRateLimiter(deps));
  app.use("/v1/auth", authRouter(deps));
  app.use("/v1", resourceRouter(deps));
  app.use("/v1", academicRouter(deps));
  app.use(errorHandler);
  return app;
}
