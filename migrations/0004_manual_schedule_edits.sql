ALTER TABLE matches ADD COLUMN schedule_manually_adjusted INTEGER NOT NULL DEFAULT 0 CHECK (schedule_manually_adjusted IN (0,1));
