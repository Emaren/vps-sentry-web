-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeCustomerId" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "hostLimit" INTEGER NOT NULL DEFAULT 1,
    "subscriptionStatus" TEXT,
    "subscriptionId" TEXT,
    "currentPeriodEnd" DATETIME
);
INSERT INTO "new_User" ("currentPeriodEnd", "email", "emailVerified", "hostLimit", "id", "image", "name", "plan", "stripeCustomerId", "subscriptionId", "subscriptionStatus") SELECT "currentPeriodEnd", "email", "emailVerified", "hostLimit", "id", "image", "name", "plan", "stripeCustomerId", "subscriptionId", "subscriptionStatus" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");
CREATE UNIQUE INDEX "User_subscriptionId_key" ON "User"("subscriptionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
