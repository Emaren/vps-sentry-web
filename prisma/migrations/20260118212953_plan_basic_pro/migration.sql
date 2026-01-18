-- CreateTable
CREATE TABLE "Host" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "lastSeenAt" DATETIME,
    "agentVersion" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Host_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HostApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "HostApiKey_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HostSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT NOT NULL,
    "ts" DATETIME NOT NULL,
    "statusJson" TEXT NOT NULL,
    "lastJson" TEXT,
    "diffJson" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "alertsCount" INTEGER NOT NULL DEFAULT 0,
    "publicPortsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HostSnapshot_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Breach" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'warn',
    "state" TEXT NOT NULL DEFAULT 'open',
    "openedTs" DATETIME NOT NULL,
    "fixedTs" DATETIME,
    "evidenceJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Breach_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationEndpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT,
    "endpointId" TEXT,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "deliveredOk" BOOLEAN,
    "deliveredTs" DATETIME,
    "error" TEXT,
    "payloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationEvent_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "NotificationEvent_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "NotificationEndpoint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RemediationAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "paramsSchemaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RemediationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "paramsJson" TEXT,
    "output" TEXT,
    "error" TEXT,
    CONSTRAINT "RemediationRun_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RemediationRun_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "RemediationAction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RemediationRun_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "hostId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "metaJson" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Host_userId_idx" ON "Host"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Host_userId_slug_key" ON "Host"("userId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "HostApiKey_tokenHash_key" ON "HostApiKey"("tokenHash");

-- CreateIndex
CREATE INDEX "HostApiKey_hostId_idx" ON "HostApiKey"("hostId");

-- CreateIndex
CREATE INDEX "HostApiKey_hostId_revokedAt_idx" ON "HostApiKey"("hostId", "revokedAt");

-- CreateIndex
CREATE INDEX "HostSnapshot_hostId_ts_idx" ON "HostSnapshot"("hostId", "ts");

-- CreateIndex
CREATE INDEX "HostSnapshot_hostId_createdAt_idx" ON "HostSnapshot"("hostId", "createdAt");

-- CreateIndex
CREATE INDEX "Breach_hostId_state_idx" ON "Breach"("hostId", "state");

-- CreateIndex
CREATE INDEX "Breach_hostId_openedTs_idx" ON "Breach"("hostId", "openedTs");

-- CreateIndex
CREATE INDEX "Breach_hostId_updatedAt_idx" ON "Breach"("hostId", "updatedAt");

-- CreateIndex
CREATE INDEX "NotificationEndpoint_userId_idx" ON "NotificationEndpoint"("userId");

-- CreateIndex
CREATE INDEX "NotificationEndpoint_userId_kind_idx" ON "NotificationEndpoint"("userId", "kind");

-- CreateIndex
CREATE INDEX "NotificationEvent_hostId_createdAt_idx" ON "NotificationEvent"("hostId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_endpointId_createdAt_idx" ON "NotificationEvent"("endpointId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_eventType_createdAt_idx" ON "NotificationEvent"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RemediationAction_key_key" ON "RemediationAction"("key");

-- CreateIndex
CREATE INDEX "RemediationRun_hostId_requestedAt_idx" ON "RemediationRun"("hostId", "requestedAt");

-- CreateIndex
CREATE INDEX "RemediationRun_hostId_state_idx" ON "RemediationRun"("hostId", "state");

-- CreateIndex
CREATE INDEX "RemediationRun_actionId_requestedAt_idx" ON "RemediationRun"("actionId", "requestedAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_hostId_createdAt_idx" ON "AuditLog"("hostId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
