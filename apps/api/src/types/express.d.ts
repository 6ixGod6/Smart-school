import type { AuthPrincipal } from "@smart-school/shared";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPrincipal;
    }
  }
}

export {};
