ALTER TABLE schedule_settings ADD COLUMN half_duration_minutes INTEGER NOT NULL DEFAULT 10
  CHECK (half_duration_minutes BETWEEN 1 AND 120);

UPDATE schedule_settings
SET half_duration_minutes = MAX(1, CAST((match_duration_minutes + 1) / 2 AS INTEGER));
