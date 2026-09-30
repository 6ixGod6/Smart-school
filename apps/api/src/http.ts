export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function unauthenticated(message = "Authentication required"): AppError {
  return new AppError(401, "UNAUTHENTICATED", message);
}

export function forbidden(message = "You do not have permission to do that"): AppError {
  return new AppError(403, "FORBIDDEN", message);
}

export function notFound(message = "Not found"): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function conflict(code: string, message: string, details?: unknown): AppError {
  return new AppError(409, code, message, details);
}

export function tooMany(code: string, message: string): AppError {
  return new AppError(429, code, message);
}

export function asyncHandler(
  fn: (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => Promise<unknown>,
) {
  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
