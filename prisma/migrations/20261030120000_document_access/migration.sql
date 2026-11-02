-- P4-2 follow-up: document-level access was memory-only (private/edit
-- overrides were lost on restart, silently widening access back to inherit).
ALTER TABLE "KbDocument" ADD COLUMN "access" TEXT;
