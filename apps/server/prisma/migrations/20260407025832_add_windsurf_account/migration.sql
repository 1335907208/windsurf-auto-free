/*
  Warnings:

  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "User";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "WindsurfAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "status" TEXT NOT NULL,
    "registerAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorMsg" TEXT,
    "tempEmailId" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "WindsurfAccount_email_key" ON "WindsurfAccount"("email");
