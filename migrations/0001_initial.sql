PRAGMA foreign_keys = ON;

CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('school', 'region', 'club')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX organisations_kind_name_idx ON organisations(kind, name COLLATE NOCASE);

CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL CHECK (category IN ('school', 'regional', 'club')),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  venue TEXT,
  court_count INTEGER NOT NULL DEFAULT 1 CHECK (court_count BETWEEN 1 AND 20),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'completed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_on >= starts_on)
);

CREATE TABLE divisions (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  group_count INTEGER NOT NULL DEFAULT 1 CHECK (group_count IN (1, 2)),
  round_robins INTEGER NOT NULL DEFAULT 1 CHECK (round_robins IN (1, 2)),
  finals_format TEXT NOT NULL DEFAULT 'manual' CHECK (finals_format IN ('none','top_two','top_four','two_pool_crossover','manual')),
  win_points INTEGER NOT NULL DEFAULT 3,
  draw_points INTEGER NOT NULL DEFAULT 1,
  close_loss_points INTEGER NOT NULL DEFAULT 0,
  loss_points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tournament_id, name)
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  colour TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE division_teams (
  id TEXT PRIMARY KEY,
  division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  group_name TEXT NOT NULL DEFAULT 'A' CHECK (group_name IN ('A','B')),
  seed INTEGER CHECK (seed > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(division_id, team_id),
  UNIQUE(division_id, group_name, seed)
);

CREATE TRIGGER division_team_org_insert BEFORE INSERT ON division_teams
BEGIN
  SELECT RAISE(ABORT, 'Team organisation does not match tournament type')
  WHERE NOT EXISTS (
    SELECT 1 FROM teams t JOIN organisations o ON o.id = t.organisation_id
    JOIN divisions d ON d.id = NEW.division_id
    JOIN tournaments tr ON tr.id = d.tournament_id
    WHERE t.id = NEW.team_id AND o.kind = CASE tr.category WHEN 'regional' THEN 'region' ELSE tr.category END
  );
END;
CREATE TRIGGER division_team_org_update BEFORE UPDATE OF division_id, team_id ON division_teams
BEGIN
  SELECT RAISE(ABORT, 'Team organisation does not match tournament type')
  WHERE NOT EXISTS (
    SELECT 1 FROM teams t JOIN organisations o ON o.id = t.organisation_id
    JOIN divisions d ON d.id = NEW.division_id
    JOIN tournaments tr ON tr.id = d.tournament_id
    WHERE t.id = NEW.team_id AND o.kind = CASE tr.category WHEN 'regional' THEN 'region' ELSE tr.category END
  );
END;

CREATE TABLE rosters (
  id TEXT PRIMARY KEY,
  division_team_id TEXT NOT NULL REFERENCES division_teams(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  UNIQUE(division_team_id, player_id)
);

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'group' CHECK (stage IN ('group','quarter_final','semi_final','final','placement')),
  round_number INTEGER CHECK (round_number > 0),
  match_number INTEGER CHECK (match_number > 0),
  scheduled_on TEXT,
  starts_at TEXT,
  court TEXT,
  referee TEXT,
  home_division_team_id TEXT REFERENCES division_teams(id) ON DELETE RESTRICT,
  away_division_team_id TEXT REFERENCES division_teams(id) ON DELETE RESTRICT,
  home_placeholder TEXT,
  away_placeholder TEXT,
  home_source_match_id TEXT REFERENCES matches(id) ON DELETE SET NULL,
  away_source_match_id TEXT REFERENCES matches(id) ON DELETE SET NULL,
  home_source_outcome TEXT CHECK (home_source_outcome IN ('winner','loser')),
  away_source_outcome TEXT CHECK (away_source_outcome IN ('winner','loser')),
  home_score INTEGER CHECK (home_score >= 0),
  away_score INTEGER CHECK (away_score >= 0),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','forfeited')),
  is_forfeit INTEGER NOT NULL DEFAULT 0 CHECK (is_forfeit IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (home_division_team_id IS NULL OR away_division_team_id IS NULL OR home_division_team_id <> away_division_team_id),
  CHECK (status <> 'completed' OR (home_division_team_id IS NOT NULL AND away_division_team_id IS NOT NULL AND home_score IS NOT NULL AND away_score IS NOT NULL)),
  CHECK (status <> 'completed' OR stage = 'group' OR home_score <> away_score)
);
CREATE TRIGGER match_teams_insert BEFORE INSERT ON matches
BEGIN
  SELECT RAISE(ABORT, 'Match teams must belong to the division') WHERE
    (NEW.home_division_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM division_teams WHERE id = NEW.home_division_team_id AND division_id = NEW.division_id))
    OR (NEW.away_division_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM division_teams WHERE id = NEW.away_division_team_id AND division_id = NEW.division_id));
END;
CREATE TRIGGER match_teams_update BEFORE UPDATE OF division_id, home_division_team_id, away_division_team_id ON matches
BEGIN
  SELECT RAISE(ABORT, 'Match teams must belong to the division') WHERE
    (NEW.home_division_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM division_teams WHERE id = NEW.home_division_team_id AND division_id = NEW.division_id))
    OR (NEW.away_division_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM division_teams WHERE id = NEW.away_division_team_id AND division_id = NEW.division_id));
END;

CREATE TRIGGER match_result_advance AFTER UPDATE OF status, home_score, away_score ON matches
WHEN NEW.status = 'completed' AND NEW.home_score <> NEW.away_score
BEGIN
  UPDATE matches SET
    home_division_team_id = CASE WHEN home_source_match_id = NEW.id THEN
      CASE home_source_outcome WHEN 'winner' THEN
        CASE WHEN NEW.home_score > NEW.away_score THEN NEW.home_division_team_id ELSE NEW.away_division_team_id END
      ELSE CASE WHEN NEW.home_score > NEW.away_score THEN NEW.away_division_team_id ELSE NEW.home_division_team_id END END
      ELSE home_division_team_id END,
    away_division_team_id = CASE WHEN away_source_match_id = NEW.id THEN
      CASE away_source_outcome WHEN 'winner' THEN
        CASE WHEN NEW.home_score > NEW.away_score THEN NEW.home_division_team_id ELSE NEW.away_division_team_id END
      ELSE CASE WHEN NEW.home_score > NEW.away_score THEN NEW.away_division_team_id ELSE NEW.home_division_team_id END END
      ELSE away_division_team_id END
  WHERE status = 'scheduled' AND (home_source_match_id = NEW.id OR away_source_match_id = NEW.id);
END;

CREATE TABLE match_attendance (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY(match_id, player_id)
);
CREATE TRIGGER attendance_roster_check BEFORE INSERT ON match_attendance
BEGIN
  SELECT RAISE(ABORT, 'Attended player must be rostered for a team in this match') WHERE NOT EXISTS (
    SELECT 1 FROM matches m JOIN rosters r ON r.player_id = NEW.player_id
      AND r.division_team_id IN (m.home_division_team_id, m.away_division_team_id)
    WHERE m.id = NEW.match_id
  );
END;

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  division_team_id TEXT NOT NULL REFERENCES division_teams(id) ON DELETE RESTRICT
);
CREATE TRIGGER goal_roster_check BEFORE INSERT ON goals
BEGIN
  SELECT RAISE(ABORT, 'Goal team must play in this match') WHERE NOT EXISTS (
    SELECT 1 FROM matches m WHERE m.id = NEW.match_id AND NEW.division_team_id IN (m.home_division_team_id, m.away_division_team_id)
  );
  SELECT RAISE(ABORT, 'Goal scorer must be an attended roster player') WHERE NEW.player_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM rosters r JOIN match_attendance a ON a.player_id = r.player_id AND a.match_id = NEW.match_id
    WHERE r.division_team_id = NEW.division_team_id AND r.player_id = NEW.player_id
  );
END;

CREATE TRIGGER attendance_delete_goals_check BEFORE DELETE ON match_attendance
BEGIN
  SELECT RAISE(ABORT, 'Remove player goals before clearing attendance') WHERE EXISTS (
    SELECT 1 FROM goals WHERE match_id = OLD.match_id AND player_id = OLD.player_id
  );
END;

CREATE INDEX divisions_tournament_idx ON divisions(tournament_id);
CREATE INDEX division_teams_division_idx ON division_teams(division_id);
CREATE INDEX matches_division_schedule_idx ON matches(division_id, scheduled_on, starts_at);
CREATE INDEX rosters_team_idx ON rosters(division_team_id);
CREATE INDEX attendance_match_idx ON match_attendance(match_id);
CREATE INDEX goals_match_idx ON goals(match_id);

CREATE TABLE organisers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin','scorer')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  organiser_id TEXT NOT NULL REFERENCES organisers(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sessions_organiser_idx ON sessions(organiser_id);
