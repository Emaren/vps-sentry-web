ALTER TABLE "User"
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'viewer';

UPDATE "User"
SET "role" = 'owner'
WHERE lower(trim(coalesce("email", ''))) = 'tonyblumdev@gmail.com';
