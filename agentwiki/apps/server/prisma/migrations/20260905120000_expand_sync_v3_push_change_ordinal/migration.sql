ALTER TABLE "PushSessionV3Change"
  DROP CONSTRAINT "PushSessionV3Change_fields_check";

ALTER TABLE "PushSessionV3Change"
  ADD CONSTRAINT "PushSessionV3Change_fields_check" CHECK (
    "ordinal" BETWEEN 0 AND 14999
    AND "entityType" IN ('folder', 'page', 'attachment')
    AND "operation" IN (
      'archive_page',
      'archive_folder',
      'upsert_folder',
      'upsert_attachment',
      'upsert_page',
      'detach_attachment'
    )
  );
