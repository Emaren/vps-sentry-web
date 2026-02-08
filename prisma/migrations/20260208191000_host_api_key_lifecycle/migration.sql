ALTER TABLE "HostApiKey"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "HostApiKey"
  ADD COLUMN "label" TEXT;

ALTER TABLE "HostApiKey"
  ADD COLUMN "scopeJson" TEXT;

ALTER TABLE "HostApiKey"
  ADD COLUMN "revokedReason" TEXT;

ALTER TABLE "HostApiKey"
  ADD COLUMN "expiresAt" DATETIME;

ALTER TABLE "HostApiKey"
  ADD COLUMN "rotatedFromKeyId" TEXT;

CREATE INDEX "HostApiKey_hostId_version_idx" ON "HostApiKey"("hostId", "version");
CREATE INDEX "HostApiKey_hostId_expiresAt_idx" ON "HostApiKey"("hostId", "expiresAt");
