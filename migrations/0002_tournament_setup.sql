PRAGMA foreign_keys = ON;

ALTER TABLE tournaments ADD COLUMN record_goal_scorers INTEGER NOT NULL DEFAULT 0
  CHECK (record_goal_scorers IN (0, 1));
UPDATE tournaments SET record_goal_scorers = 1
WHERE EXISTS (
  SELECT 1 FROM divisions d JOIN matches m ON m.division_id = d.id
  JOIN goals g ON g.match_id = m.id WHERE d.tournament_id = tournaments.id
);
ALTER TABLE division_teams ADD COLUMN team_colour TEXT;
UPDATE division_teams SET team_colour = (
  SELECT colour FROM teams WHERE teams.id = division_teams.team_id
);

-- Existing team rows were created per tournament. Merge identical organisation/team
-- identities while keeping each historical tournament entry and its event colour.
WITH ranked_teams AS (
  SELECT id,
    FIRST_VALUE(id) OVER (
      PARTITION BY organisation_id, name COLLATE NOCASE
      ORDER BY created_at, id
    ) AS canonical_id
  FROM teams
)
UPDATE division_teams
SET team_id = (SELECT canonical_id FROM ranked_teams WHERE ranked_teams.id = division_teams.team_id)
WHERE team_id IN (SELECT id FROM ranked_teams WHERE id <> canonical_id);

DELETE FROM teams
WHERE id NOT IN (
  SELECT FIRST_VALUE(id) OVER (
    PARTITION BY organisation_id, name COLLATE NOCASE
    ORDER BY created_at, id
  )
  FROM teams
);
CREATE UNIQUE INDEX teams_organisation_name_idx
  ON teams(organisation_id, name COLLATE NOCASE);

CREATE TABLE courts (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  display_order INTEGER NOT NULL CHECK (display_order > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tournament_id, display_name COLLATE NOCASE),
  UNIQUE (tournament_id, display_order)
);

CREATE TABLE tournament_days (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  day_on TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  CHECK (ends_at > starts_at),
  UNIQUE (tournament_id, day_on),
  UNIQUE (id, day_on)
);

CREATE TRIGGER tournament_day_range_insert
BEFORE INSERT ON tournament_days
BEGIN
  SELECT RAISE(ABORT, 'Tournament day is outside the event dates')
  WHERE NEW.day_on < (SELECT starts_on FROM tournaments WHERE id = NEW.tournament_id)
     OR NEW.day_on > (SELECT ends_on FROM tournaments WHERE id = NEW.tournament_id);
END;
CREATE TRIGGER tournament_day_range_update
BEFORE UPDATE OF tournament_id, day_on ON tournament_days
BEGIN
  SELECT RAISE(ABORT, 'Tournament day is outside the event dates')
  WHERE NEW.day_on < (SELECT starts_on FROM tournaments WHERE id = NEW.tournament_id)
     OR NEW.day_on > (SELECT ends_on FROM tournaments WHERE id = NEW.tournament_id);
END;

CREATE TABLE day_breaks (
  id TEXT PRIMARY KEY,
  tournament_day_id TEXT NOT NULL REFERENCES tournament_days(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'Break',
  CHECK (ends_at > starts_at)
);

CREATE TABLE schedule_settings (
  tournament_id TEXT PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  match_duration_minutes INTEGER NOT NULL DEFAULT 20 CHECK (match_duration_minutes BETWEEN 1 AND 240),
  halftime_minutes INTEGER NOT NULL DEFAULT 2 CHECK (halftime_minutes BETWEEN 0 AND 60),
  gap_between_games_minutes INTEGER NOT NULL DEFAULT 0 CHECK (gap_between_games_minutes BETWEEN 0 AND 180),
  team_turnaround_minutes INTEGER NOT NULL DEFAULT 20 CHECK (team_turnaround_minutes BETWEEN 0 AND 720)
);

CREATE TABLE court_availability (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  court_id TEXT NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  day_on TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  CHECK (ends_at > starts_at),
  FOREIGN KEY (tournament_id, day_on) REFERENCES tournament_days(tournament_id, day_on) ON DELETE CASCADE,
  UNIQUE (court_id, day_on, starts_at, ends_at)
);

CREATE TABLE division_court_rules (
  id TEXT PRIMARY KEY,
  division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  court_id TEXT NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
  allocation_type TEXT NOT NULL CHECK (allocation_type IN ('required', 'preferred')),
  preference_order INTEGER NOT NULL DEFAULT 1 CHECK (preference_order > 0),
  UNIQUE (division_id, court_id)
);

CREATE TRIGGER division_court_rule_tournament_insert
BEFORE INSERT ON division_court_rules
BEGIN
  SELECT RAISE(ABORT, 'Court and division must belong to the same tournament')
  WHERE NOT EXISTS (
    SELECT 1 FROM divisions d JOIN courts c ON c.tournament_id = d.tournament_id
    WHERE d.id = NEW.division_id AND c.id = NEW.court_id
  );
END;
CREATE TRIGGER division_court_rule_tournament_update
BEFORE UPDATE OF division_id, court_id ON division_court_rules
BEGIN
  SELECT RAISE(ABORT, 'Court and division must belong to the same tournament')
  WHERE NOT EXISTS (
    SELECT 1 FROM divisions d JOIN courts c ON c.tournament_id = d.tournament_id
    WHERE d.id = NEW.division_id AND c.id = NEW.court_id
  );
END;

CREATE TRIGGER court_availability_tournament_insert
BEFORE INSERT ON court_availability
BEGIN
  SELECT RAISE(ABORT, 'Court and availability day must belong to the same tournament')
  WHERE NOT EXISTS (
    SELECT 1 FROM courts c WHERE c.id = NEW.court_id AND c.tournament_id = NEW.tournament_id
  );
END;
CREATE TRIGGER court_availability_tournament_update
BEFORE UPDATE OF tournament_id, court_id, day_on ON court_availability
BEGIN
  SELECT RAISE(ABORT, 'Court and availability day must belong to the same tournament')
  WHERE NOT EXISTS (
    SELECT 1 FROM courts c WHERE c.id = NEW.court_id AND c.tournament_id = NEW.tournament_id
  );
END;

ALTER TABLE matches ADD COLUMN court_id TEXT REFERENCES courts(id) ON DELETE SET NULL;

CREATE TRIGGER match_court_tournament_insert
BEFORE INSERT ON matches
WHEN NEW.court_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Court and match must belong to the same tournament')
  WHERE NOT EXISTS (
    SELECT 1 FROM divisions d JOIN courts c ON c.tournament_id = d.tournament_id
    WHERE d.id = NEW.division_id AND c.id = NEW.court_id
  );
END;
CREATE TRIGGER match_court_tournament_update
BEFORE UPDATE OF division_id, court_id ON matches
WHEN NEW.court_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Court and match must belong to the same tournament')
  WHERE NOT EXISTS (
    SELECT 1 FROM divisions d JOIN courts c ON c.tournament_id = d.tournament_id
    WHERE d.id = NEW.division_id AND c.id = NEW.court_id
  );
END;

-- Give existing events their current conventional court names, then preserve any
-- custom court labels already used by a fixture.
WITH RECURSIVE court_numbers(n) AS (
  SELECT 1
  UNION ALL SELECT n + 1 FROM court_numbers WHERE n < 20
)
INSERT INTO courts (id, tournament_id, display_name, display_order, active)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  t.id, 'Court ' || court_numbers.n, court_numbers.n, 1
FROM tournaments t JOIN court_numbers ON court_numbers.n <= t.court_count;

WITH used_names AS (
  SELECT DISTINCT t.id AS tournament_id, trim(m.court) AS display_name, t.court_count
  FROM matches m
  JOIN divisions d ON d.id = m.division_id
  JOIN tournaments t ON t.id = d.tournament_id
  WHERE m.court IS NOT NULL AND length(trim(m.court)) > 0
), extras AS (
  SELECT tournament_id, display_name, court_count,
    ROW_NUMBER() OVER (PARTITION BY tournament_id ORDER BY display_name COLLATE NOCASE) AS extra_order
  FROM used_names
  WHERE NOT EXISTS (
    SELECT 1 FROM courts c
    WHERE c.tournament_id = used_names.tournament_id
      AND c.display_name = used_names.display_name COLLATE NOCASE
  )
)
INSERT INTO courts (id, tournament_id, display_name, display_order, active)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  tournament_id, display_name, court_count + extra_order, 1
FROM extras;

UPDATE matches
SET court_id = (
  SELECT c.id FROM courts c
  JOIN divisions d ON d.tournament_id = c.tournament_id
  WHERE d.id = matches.division_id AND c.display_name = matches.court COLLATE NOCASE
  ORDER BY c.display_order LIMIT 1
);

WITH RECURSIVE event_days(tournament_id, day_on, ends_on) AS (
  SELECT id, starts_on, ends_on FROM tournaments
  UNION ALL
  SELECT tournament_id, date(day_on, '+1 day'), ends_on
  FROM event_days WHERE day_on < ends_on
)
INSERT INTO tournament_days (id, tournament_id, day_on, available, starts_at, ends_at)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  tournament_id, day_on, 1, '09:00', '17:00'
FROM event_days;

INSERT INTO schedule_settings (tournament_id)
SELECT id FROM tournaments;

INSERT INTO court_availability (id, tournament_id, court_id, day_on, starts_at, ends_at)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  c.tournament_id, c.id, d.day_on, d.starts_at, d.ends_at
FROM courts c JOIN tournament_days d ON d.tournament_id = c.tournament_id
WHERE c.active = 1 AND d.available = 1;

CREATE INDEX courts_tournament_order_idx ON courts(tournament_id, active, display_order);
CREATE INDEX tournament_days_tournament_date_idx ON tournament_days(tournament_id, day_on);
CREATE INDEX court_availability_day_idx ON court_availability(tournament_id, day_on, court_id);
CREATE INDEX division_court_rules_division_idx ON division_court_rules(division_id, allocation_type, preference_order);
CREATE INDEX matches_court_time_idx ON matches(court_id, scheduled_on, starts_at);
