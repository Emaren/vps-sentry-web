DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'IncidentSeverity'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "IncidentSeverity" AS ENUM ('critical', 'high', 'medium');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'IncidentState'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "IncidentState" AS ENUM ('open', 'acknowledged', 'resolved', 'closed');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'PostmortemStatus'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "PostmortemStatus" AS ENUM ('not_started', 'draft', 'published', 'waived');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "IncidentWorkflowRun" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "workflowTitle" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "severity" "IncidentSeverity" NOT NULL DEFAULT 'medium',
  "state" "IncidentState" NOT NULL DEFAULT 'open',
  "triggerSignal" TEXT,
  "hostId" TEXT,
  "createdByUserId" TEXT,
  "assigneeUserId" TEXT,
  "assigneeEmail" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedByUserId" TEXT,
  "ackDueAt" TIMESTAMP(3),
  "escalatedAt" TIMESTAMP(3),
  "escalationCount" INTEGER NOT NULL DEFAULT 0,
  "nextEscalationAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  "closedAt" TIMESTAMP(3),
  "closedByUserId" TEXT,
  "postmortemStatus" "PostmortemStatus" NOT NULL DEFAULT 'not_started',
  "postmortemSummary" TEXT,
  "postmortemImpact" TEXT,
  "postmortemRootCause" TEXT,
  "postmortemActionItemsJson" TEXT,
  "postmortemPublishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IncidentWorkflowRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "IncidentWorkflowEvent" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "stepId" TEXT,
  "message" TEXT NOT NULL,
  "eventTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorUserId" TEXT,
  "metaJson" TEXT,
  CONSTRAINT "IncidentWorkflowEvent_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'IncidentWorkflowRun_hostId_fkey'
  ) THEN
    ALTER TABLE "IncidentWorkflowRun"
      ADD CONSTRAINT "IncidentWorkflowRun_hostId_fkey"
      FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'IncidentWorkflowRun_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "IncidentWorkflowRun"
      ADD CONSTRAINT "IncidentWorkflowRun_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'IncidentWorkflowRun_assigneeUserId_fkey'
  ) THEN
    ALTER TABLE "IncidentWorkflowRun"
      ADD CONSTRAINT "IncidentWorkflowRun_assigneeUserId_fkey"
      FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'IncidentWorkflowRun_acknowledgedByUserId_fkey'
  ) THEN
    ALTER TABLE "IncidentWorkflowRun"
      ADD CONSTRAINT "IncidentWorkflowRun_acknowledgedByUserId_fkey"
      FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'IncidentWorkflowRun_resolvedByUserId_fkey'
  ) THEN
    ALTER TABLE "IncidentWorkflowRun"
      ADD CONSTRAINT "IncidentWorkflowRun_resolvedByUserId_fkey"
      FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'IncidentWorkflowRun_closedByUserId_fkey'
  ) THEN
    ALTER TABLE "IncidentWorkflowRun"
      ADD CONSTRAINT "IncidentWorkflowRun_closedByUserId_fkey"
      FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'IncidentWorkflowEvent_incidentId_fkey'
  ) THEN
    ALTER TABLE "IncidentWorkflowEvent"
      ADD CONSTRAINT "IncidentWorkflowEvent_incidentId_fkey"
      FOREIGN KEY ("incidentId") REFERENCES "IncidentWorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'IncidentWorkflowEvent_actorUserId_fkey'
  ) THEN
    ALTER TABLE "IncidentWorkflowEvent"
      ADD CONSTRAINT "IncidentWorkflowEvent_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IncidentWorkflowRun_state_createdAt_idx"
  ON "IncidentWorkflowRun"("state", "createdAt");
CREATE INDEX IF NOT EXISTS "IncidentWorkflowRun_workflowId_createdAt_idx"
  ON "IncidentWorkflowRun"("workflowId", "createdAt");
CREATE INDEX IF NOT EXISTS "IncidentWorkflowRun_hostId_createdAt_idx"
  ON "IncidentWorkflowRun"("hostId", "createdAt");
CREATE INDEX IF NOT EXISTS "IncidentWorkflowRun_ackDueAt_state_idx"
  ON "IncidentWorkflowRun"("ackDueAt", "state");
CREATE INDEX IF NOT EXISTS "IncidentWorkflowRun_nextEscalationAt_state_idx"
  ON "IncidentWorkflowRun"("nextEscalationAt", "state");
CREATE INDEX IF NOT EXISTS "IncidentWorkflowRun_createdByUserId_createdAt_idx"
  ON "IncidentWorkflowRun"("createdByUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "IncidentWorkflowRun_assigneeUserId_state_idx"
  ON "IncidentWorkflowRun"("assigneeUserId", "state");

CREATE INDEX IF NOT EXISTS "IncidentWorkflowEvent_incidentId_eventTs_idx"
  ON "IncidentWorkflowEvent"("incidentId", "eventTs");
CREATE INDEX IF NOT EXISTS "IncidentWorkflowEvent_type_eventTs_idx"
  ON "IncidentWorkflowEvent"("type", "eventTs");
CREATE INDEX IF NOT EXISTS "IncidentWorkflowEvent_actorUserId_eventTs_idx"
  ON "IncidentWorkflowEvent"("actorUserId", "eventTs");
