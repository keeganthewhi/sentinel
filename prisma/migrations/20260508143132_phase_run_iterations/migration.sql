-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PhaseRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanId" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "scanner" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "findingCount" INTEGER NOT NULL DEFAULT 0,
    "rawOutput" TEXT,
    "errorLog" TEXT,
    "iterations" JSONB NOT NULL DEFAULT [],
    CONSTRAINT "PhaseRun_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PhaseRun" ("completedAt", "errorLog", "findingCount", "id", "phase", "rawOutput", "scanId", "scanner", "startedAt", "status") SELECT "completedAt", "errorLog", "findingCount", "id", "phase", "rawOutput", "scanId", "scanner", "startedAt", "status" FROM "PhaseRun";
DROP TABLE "PhaseRun";
ALTER TABLE "new_PhaseRun" RENAME TO "PhaseRun";
CREATE INDEX "PhaseRun_scanId_phase_idx" ON "PhaseRun"("scanId", "phase");
CREATE INDEX "PhaseRun_scanId_scanner_idx" ON "PhaseRun"("scanId", "scanner");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
