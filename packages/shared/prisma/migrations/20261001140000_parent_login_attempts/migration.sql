-- Phone + client-IP throttle for parent PIN attempts. No school_id: this is
-- a platform-level brute-force brake, not a tenant row.
CREATE TABLE "parent_login_attempts" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "window_started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "parent_login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parent_login_attempts_phone_ip_key" ON "parent_login_attempts"("phone", "ip");
CREATE INDEX "parent_login_attempts_phone_idx" ON "parent_login_attempts"("phone");
