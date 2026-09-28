ALTER TABLE matches ADD COLUMN schedule_issue TEXT;
ALTER TABLE matches ADD COLUMN schedule_warning TEXT;

CREATE INDEX matches_tournament_schedule_idx
  ON matches(division_id, scheduled_on, starts_at, court_id);
