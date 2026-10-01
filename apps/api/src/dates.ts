import { badRequest } from "./http.ts";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateOnly(value: string, field = "date"): Date {
  if (!DATE_ONLY.test(value)) {
    throw badRequest(`${field} must be YYYY-MM-DD.`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

export function dateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function todayUtcDateString(): string {
  return dateOnlyString(new Date());
}
