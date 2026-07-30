-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Paste" (
    "id" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "salt" BYTEA NOT NULL,
    "kdf" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Paste_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Paste_expiresAt_idx" ON "Paste"("expiresAt");

