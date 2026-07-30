-- CreateTable
CREATE TABLE "Paste" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ciphertext" BLOB NOT NULL,
    "iv" BLOB NOT NULL,
    "salt" BLOB NOT NULL,
    "kdf" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Paste_expiresAt_idx" ON "Paste"("expiresAt");
