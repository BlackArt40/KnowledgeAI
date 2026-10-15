-- P7-3: knowledge graph - NER-extracted entities and sentence co-occurrence
-- relations per KB (used by graph visualization + GraphRAG retrieval).
-- Entity/relation ids are stable hashes of (kbId, label) / (kbId, source,
-- target) so upserts are idempotent. See src/lib/kg/.

-- CreateTable
CREATE TABLE "KnowledgeEntity" (
    "id" TEXT NOT NULL,
    "kbId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mentions" INTEGER NOT NULL DEFAULT 1,
    "docIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeEntity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeEntity_kbId_idx" ON "KnowledgeEntity"("kbId");

-- CreateTable
CREATE TABLE "KnowledgeRelation" (
    "id" TEXT NOT NULL,
    "kbId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'co-occurs',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "docIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeRelation_kbId_idx" ON "KnowledgeRelation"("kbId");
