-- Preserve legacy sessions while allowing the unified prompt-driven turn mode.
ALTER TABLE "AssistTask"
  DROP CONSTRAINT "AssistTask_mode_check",
  ADD CONSTRAINT "AssistTask_mode_check" CHECK ("mode" IN ('auto', 'question', 'proposal'));
