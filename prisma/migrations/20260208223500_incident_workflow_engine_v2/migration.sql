CREATE TABLE "IncidentWorkflowRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowId" TEXT NOT NULL,
  "workflowTitle" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "severity" TEXT NOT NULL DEFAULT 'medium',
  "state" TEXT NOT NULL DEFAULT 'open',
  "triggerSignal" TEXT,
  "hostId" TEXT,
  "createdByUserId" TEXT,
  "assigneeUserId" TEXT,
  "assigneeEmail" TEXT,
  "acknowledgedAt" DATETIME,
  "acknowledgedByUserId" TEXT,
  "ackDueAt" DATETIME,
  "escalatedAt" DATETIME,
  "escalationCount" INTEGER NOT NULL DEFAULT 0,
  "nextEscalationAt" DATETIME,
  "resolvedAt" DATETIME,
  "resolvedByUserId" TEXT,
  "closedAt" DATETIME,
  "closedByUserId" TEXT,
  "postmortemStatus" TEXT NOT NULL DEFAULT 'not_started',
  "postmortemSummary" TEXT,
  "postmortemImpact" TEXT,
  "postmortemRootCause" TEXT,
  "postmortemActionItemsJson" TEXT,
  "postmortemPublishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IncidentWorkflowRun_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "IncidentWorkflowRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "IncidentWorkflowRun_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "IncidentWorkflowRun_acknowledgedByUserId_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "IncidentWorkflowRun_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "IncidentWorkflowRun_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "IncidentWorkflowEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "incidentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "stepId" TEXT,
  "message" TEXT NOT NULL,
  "eventTs" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorUserId" TEXT,
  "metaJson" TEXT,
  CONSTRAINT "IncidentWorkflowEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "IncidentWorkflowRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IncidentWorkflowEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "IncidentWorkflowRun_state_createdAt_idx" ON "IncidentWorkflowRun"("state", "createdAt");
CREATE INDEX "IncidentWorkflowRun_workflowId_createdAt_idx" ON "IncidentWorkflowRun"("workflowId", "createdAt");
CREATE INDEX "IncidentWorkflowRun_hostId_createdAt_idx" ON "IncidentWorkflowRun"("hostId", "createdAt");
CREATE INDEX "IncidentWorkflowRun_ackDueAt_state_idx" ON "IncidentWorkflowRun"("ackDueAt", "state");
CREATE INDEX "IncidentWorkflowRun_nextEscalationAt_state_idx" ON "IncidentWorkflowRun"("nextEscalationAt", "state");
CREATE INDEX "IncidentWorkflowRun_createdByUserId_createdAt_idx" ON "IncidentWorkflowRun"("createdByUserId", "createdAt");
CREATE INDEX "IncidentWorkflowRun_assigneeUserId_state_idx" ON "IncidentWorkflowRun"("assigneeUserId", "state");

CREATE INDEX "IncidentWorkflowEvent_incidentId_eventTs_idx" ON "IncidentWorkflowEvent"("incidentId", "eventTs");
CREATE INDEX "IncidentWorkflowEvent_type_eventTs_idx" ON "IncidentWorkflowEvent"("type", "eventTs");
CREATE INDEX "IncidentWorkflowEvent_actorUserId_eventTs_idx" ON "IncidentWorkflowEvent"("actorUserId", "eventTs");
