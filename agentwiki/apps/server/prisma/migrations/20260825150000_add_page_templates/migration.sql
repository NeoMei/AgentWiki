BEGIN;
CREATE TYPE "PageTemplateScope" AS ENUM ('system', 'space');
CREATE TYPE "PageTemplateCategory" AS ENUM ('planning', 'reporting', 'knowledge', 'other');

CREATE TABLE "PageTemplate" (
  "id" TEXT NOT NULL,
  "scope" "PageTemplateScope" NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "spaceId" TEXT,
  "stableKey" TEXT NOT NULL,
  "category" "PageTemplateCategory" NOT NULL,
  "displayOrder" INTEGER,
  "nameI18n" JSONB NOT NULL,
  "nameKey" TEXT,
  "descriptionI18n" JSONB NOT NULL,
  "defaultTitleI18n" JSONB NOT NULL,
  "sourceLocale" TEXT,
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT,
  "updatedById" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PageTemplateVersion" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "contentI18n" JSONB NOT NULL,
  "sourcePageId" TEXT,
  "contentHash" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PageTemplateVersion_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Page" ADD COLUMN "sourceTemplateId" TEXT;
ALTER TABLE "Page" ADD COLUMN "sourceTemplateVersion" INTEGER;
ALTER TABLE "Page" ADD COLUMN "sourceTemplateLocale" TEXT;

CREATE UNIQUE INDEX "PageTemplate_scopeKey_stableKey_key" ON "PageTemplate"("scopeKey", "stableKey");
CREATE UNIQUE INDEX "PageTemplate_spaceId_nameKey_key" ON "PageTemplate"("spaceId", "nameKey");
CREATE INDEX "PageTemplate_spaceId_archivedAt_updatedAt_idx" ON "PageTemplate"("spaceId", "archivedAt", "updatedAt");
CREATE UNIQUE INDEX "PageTemplateVersion_templateId_version_key" ON "PageTemplateVersion"("templateId", "version");
CREATE INDEX "PageTemplateVersion_templateId_createdAt_idx" ON "PageTemplateVersion"("templateId", "createdAt");
CREATE INDEX "PageTemplateVersion_sourcePageId_idx" ON "PageTemplateVersion"("sourcePageId");
CREATE INDEX "Page_sourceTemplateId_sourceTemplateVersion_idx" ON "Page"("sourceTemplateId", "sourceTemplateVersion");

ALTER TABLE "PageTemplate" ADD CONSTRAINT "PageTemplate_scope_check" CHECK (
  ("scope" = 'system' AND "scopeKey" = 'system' AND "spaceId" IS NULL AND "sourceLocale" IS NULL AND "nameKey" IS NULL AND "displayOrder" IS NOT NULL)
  OR
  ("scope" = 'space' AND "spaceId" IS NOT NULL AND "scopeKey" = "spaceId" AND "sourceLocale" IS NOT NULL AND "sourceLocale" IN ('zh-CN', 'en') AND "nameKey" IS NOT NULL)
);
ALTER TABLE "PageTemplate" ADD CONSTRAINT "PageTemplate_current_version_check" CHECK ("currentVersion" >= 1);
ALTER TABLE "PageTemplateVersion" ADD CONSTRAINT "PageTemplateVersion_version_check" CHECK ("version" >= 1);
ALTER TABLE "Page" ADD CONSTRAINT "Page_template_source_tuple_check" CHECK (
  ("sourceTemplateId" IS NULL AND "sourceTemplateVersion" IS NULL AND "sourceTemplateLocale" IS NULL)
  OR
  ("sourceTemplateId" IS NOT NULL AND "sourceTemplateVersion" IS NOT NULL AND "sourceTemplateLocale" IS NOT NULL AND "sourceTemplateLocale" IN ('zh-CN', 'en'))
);

CREATE FUNCTION "reject_page_template_version_update"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'PageTemplateVersion rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PageTemplateVersion_immutable_update"
BEFORE UPDATE ON "PageTemplateVersion"
FOR EACH ROW
EXECUTE FUNCTION "reject_page_template_version_update"();

ALTER TABLE "PageTemplate" ADD CONSTRAINT "PageTemplate_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageTemplate" ADD CONSTRAINT "PageTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PageTemplate" ADD CONSTRAINT "PageTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PageTemplateVersion" ADD CONSTRAINT "PageTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageTemplateVersion" ADD CONSTRAINT "PageTemplateVersion_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PageTemplateVersion" ADD CONSTRAINT "PageTemplateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_sourceTemplate_version_fkey" FOREIGN KEY ("sourceTemplateId", "sourceTemplateVersion") REFERENCES "PageTemplateVersion"("templateId", "version") ON DELETE RESTRICT ON UPDATE RESTRICT;
COMMIT;
