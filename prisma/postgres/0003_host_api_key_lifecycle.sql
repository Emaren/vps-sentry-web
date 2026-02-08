ALTER TABLE "HostApiKey"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "HostApiKey"
  ADD COLUMN IF NOT EXISTS "label" TEXT;

ALTER TABLE "HostApiKey"
  ADD COLUMN IF NOT EXISTS "scopeJson" TEXT;

ALTER TABLE "HostApiKey"
  ADD COLUMN IF NOT EXISTS "revokedReason" TEXT;

ALTER TABLE "HostApiKey"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

ALTER TABLE "HostApiKey"
  ADD COLUMN IF NOT EXISTS "rotatedFromKeyId" TEXT;

CREATE INDEX IF NOT EXISTS "HostApiKey_hostId_version_idx"
  ON "HostApiKey"("hostId", "version");

CREATE INDEX IF NOT EXISTS "HostApiKey_hostId_expiresAt_idx"
  ON "HostApiKey"("hostId", "expiresAt");
