-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "targetRepo" TEXT NOT NULL,
    "targetUrl" TEXT,
    "governed" BOOLEAN NOT NULL DEFAULT false,
    "blueprintMd" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PhaseRun" (
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
    CONSTRAINT "PhaseRun_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "normalizedScore" REAL NOT NULL DEFAULT 0,
    "scanner" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "cveId" TEXT,
    "cweId" TEXT,
    "filePath" TEXT,
    "lineNumber" INTEGER,
    "endpoint" TEXT,
    "evidence" TEXT,
    "exploitProof" TEXT,
    "remediation" TEXT,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "correlationId" TEXT,
    "isRegression" BOOLEAN NOT NULL DEFAULT false,
    "governorAction" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Finding_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GovernorDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanId" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "decisionType" TEXT NOT NULL,
    "inputJson" TEXT NOT NULL,
    "outputJson" TEXT,
    "rationale" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GovernorDecision_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanId" TEXT NOT NULL,
    "markdownPath" TEXT,
    "jsonPath" TEXT,
    "pdfPath" TEXT,
    "summary" TEXT,
    "aiAuthored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Report_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Scan_targetRepo_idx" ON "Scan"("targetRepo");

-- CreateIndex
CREATE INDEX "Scan_startedAt_idx" ON "Scan"("startedAt");

-- CreateIndex
CREATE INDEX "PhaseRun_scanId_phase_idx" ON "PhaseRun"("scanId", "phase");

-- CreateIndex
CREATE INDEX "PhaseRun_scanId_scanner_idx" ON "PhaseRun"("scanId", "scanner");

-- CreateIndex
CREATE INDEX "Finding_scanId_severity_idx" ON "Finding"("scanId", "severity");

-- CreateIndex
CREATE INDEX "Finding_scanId_category_idx" ON "Finding"("scanId", "category");

-- CreateIndex
CREATE INDEX "Finding_scanId_scanner_idx" ON "Finding"("scanId", "scanner");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_scanId_fingerprint_key" ON "Finding"("scanId", "fingerprint");

-- CreateIndex
CREATE INDEX "GovernorDecision_scanId_phase_idx" ON "GovernorDecision"("scanId", "phase");

-- CreateIndex
CREATE INDEX "GovernorDecision_scanId_decisionType_idx" ON "GovernorDecision"("scanId", "decisionType");

-- CreateIndex
CREATE UNIQUE INDEX "Report_scanId_key" ON "Report"("scanId");
