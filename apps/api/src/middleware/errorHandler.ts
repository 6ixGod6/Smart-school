import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../http.ts";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request body is invalid.",
        details: err.flatten(),
      },
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    error: { code: "INTERNAL", message: "Something went wrong." },
  });
}
