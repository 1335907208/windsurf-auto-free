/*
  Warnings:

  - A unique constraint covering the columns `[messageId]` on the table `EmailMessage` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_messageId_key" ON "EmailMessage"("messageId");
