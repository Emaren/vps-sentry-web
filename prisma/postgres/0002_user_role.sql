DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'UserRole'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "UserRole" AS ENUM ('owner', 'admin', 'ops', 'viewer');
  END IF;
END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'viewer';

UPDATE "User"
SET "role" = 'owner'
WHERE lower(trim(coalesce("email", ''))) = 'tonyblumdev@gmail.com';
