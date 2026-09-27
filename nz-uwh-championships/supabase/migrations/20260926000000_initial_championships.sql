-- New Zealand Underwater Hockey Championships starts with no Auckland data.
-- Tournament formats are configured per division; fixtures use calendar dates.
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'scorer')),
  PRIMARY KEY (user_id, role)
);

CREATE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  category text NOT NULL CHECK (category IN ('school', 'regional', 'club')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  venue text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE public.divisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  group_count integer NOT NULL DEFAULT 1 CHECK (group_count IN (1, 2)),
  round_robins integer NOT NULL DEFAULT 1 CHECK (round_robins IN (1, 2)),
  win_points integer NOT NULL DEFAULT 3,
  draw_points integer NOT NULL DEFAULT 1,
  close_loss_points integer NOT NULL DEFAULT 0,
  loss_points integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, name)
);

CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  organisation text,
  colour text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.division_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id uuid NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  group_name text,
  seed integer CHECK (seed > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (division_id, team_id),
  UNIQUE (division_id, group_name, seed)
);

CREATE TABLE public.rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_team_id uuid NOT NULL REFERENCES public.division_teams(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  UNIQUE (division_team_id, player_id)
);

CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id uuid NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'group' CHECK (stage IN ('group', 'quarter_final', 'semi_final', 'final', 'placement')),
  round_number integer CHECK (round_number > 0),
  match_number integer CHECK (match_number > 0),
  scheduled_on date,
  starts_at time,
  court text,
  referee text,
  home_division_team_id uuid REFERENCES public.division_teams(id) ON DELETE RESTRICT,
  away_division_team_id uuid REFERENCES public.division_teams(id) ON DELETE RESTRICT,
  home_placeholder text,
  away_placeholder text,
  home_source_match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  away_source_match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  home_source_outcome text CHECK (home_source_outcome IN ('winner', 'loser')),
  away_source_outcome text CHECK (away_source_outcome IN ('winner', 'loser')),
  home_score integer CHECK (home_score >= 0),
  away_score integer CHECK (away_score >= 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'forfeited')),
  is_forfeit boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (home_division_team_id IS NULL OR away_division_team_id IS NULL OR home_division_team_id <> away_division_team_id),
  CHECK (status <> 'completed' OR stage = 'group' OR home_score <> away_score),
  CHECK (status <> 'completed' OR (home_division_team_id IS NOT NULL AND away_division_team_id IS NOT NULL AND home_score IS NOT NULL AND away_score IS NOT NULL))
);

CREATE TABLE public.match_attendance (
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  PRIMARY KEY (match_id, player_id)
);

CREATE TABLE public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  division_team_id uuid NOT NULL REFERENCES public.division_teams(id) ON DELETE RESTRICT
);

CREATE FUNCTION public.validate_match_attendance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.rosters r ON r.player_id = NEW.player_id
      AND r.division_team_id IN (m.home_division_team_id, m.away_division_team_id)
    WHERE m.id = NEW.match_id
  ) THEN RAISE EXCEPTION 'Attended player must be rostered for a team in this match'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_match_attendance_before_write
  BEFORE INSERT OR UPDATE ON public.match_attendance
  FOR EACH ROW EXECUTE FUNCTION public.validate_match_attendance();

CREATE FUNCTION public.validate_match_goal()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.matches m WHERE m.id = NEW.match_id
      AND NEW.division_team_id IN (m.home_division_team_id, m.away_division_team_id)
  ) THEN RAISE EXCEPTION 'Goal team must play in this match'; END IF;
  IF NEW.player_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rosters r JOIN public.match_attendance a
      ON a.player_id = r.player_id AND a.match_id = NEW.match_id
    WHERE r.division_team_id = NEW.division_team_id AND r.player_id = NEW.player_id
  ) THEN RAISE EXCEPTION 'Goal scorer must be an attended roster player'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_match_goal_before_write
  BEFORE INSERT OR UPDATE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION public.validate_match_goal();

CREATE INDEX divisions_tournament_idx ON public.divisions (tournament_id);
CREATE INDEX division_teams_division_idx ON public.division_teams (division_id);
CREATE INDEX matches_division_schedule_idx ON public.matches (division_id, scheduled_on, starts_at);
CREATE INDEX rosters_team_idx ON public.rosters (division_team_id);

CREATE FUNCTION public.validate_match_division()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.division_teams entry
    WHERE entry.id IN (NEW.home_division_team_id, NEW.away_division_team_id)
      AND entry.division_id <> NEW.division_id
  ) THEN
    RAISE EXCEPTION 'Both match teams must belong to the division';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_match_division_before_write
  BEFORE INSERT OR UPDATE OF division_id, home_division_team_id, away_division_team_id
  ON public.matches FOR EACH ROW EXECUTE FUNCTION public.validate_match_division();

CREATE FUNCTION public.advance_match_result()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  winner_id uuid;
  loser_id uuid;
BEGIN
  IF NEW.status <> 'completed' OR NEW.home_score = NEW.away_score
     OR NEW.home_division_team_id IS NULL OR NEW.away_division_team_id IS NULL THEN
    RETURN NEW;
  END IF;
  winner_id := CASE WHEN NEW.home_score > NEW.away_score THEN NEW.home_division_team_id ELSE NEW.away_division_team_id END;
  loser_id := CASE WHEN NEW.home_score > NEW.away_score THEN NEW.away_division_team_id ELSE NEW.home_division_team_id END;
  UPDATE public.matches SET home_division_team_id = CASE home_source_outcome WHEN 'winner' THEN winner_id ELSE loser_id END
    WHERE home_source_match_id = NEW.id AND status = 'scheduled';
  UPDATE public.matches SET away_division_team_id = CASE away_source_outcome WHEN 'winner' THEN winner_id ELSE loser_id END
    WHERE away_source_match_id = NEW.id AND status = 'scheduled';
  RETURN NEW;
END $$;
CREATE TRIGGER advance_match_result_after_write
  AFTER INSERT OR UPDATE OF status, home_score, away_score ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.advance_match_result();

CREATE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER tournaments_touch_updated_at BEFORE UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER matches_touch_updated_at BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Public pages can read published tournament data. Admins can inspect drafts.
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read published tournaments" ON public.tournaments FOR SELECT TO anon, authenticated
  USING (status <> 'draft' OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage tournaments" ON public.tournaments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read published divisions" ON public.divisions FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id AND (t.status <> 'draft' OR public.has_role(auth.uid(), 'admin'))));
CREATE POLICY "Admins manage divisions" ON public.divisions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.division_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read teams" ON public.teams FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Read players" ON public.players FOR SELECT TO authenticated USING (true);
CREATE POLICY "Read division teams" ON public.division_teams FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.divisions d WHERE d.id = division_id));
CREATE POLICY "Read rosters" ON public.rosters FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.division_teams dt WHERE dt.id = division_team_id));
CREATE POLICY "Read matches" ON public.matches FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.divisions d WHERE d.id = division_id));
CREATE POLICY "Read attendance" ON public.match_attendance FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.matches m WHERE m.id = match_id));
CREATE POLICY "Read goals" ON public.goals FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.matches m WHERE m.id = match_id));

CREATE POLICY "Admins manage teams" ON public.teams FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage players" ON public.players FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage division teams" ON public.division_teams FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage rosters" ON public.rosters FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage matches" ON public.matches FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage attendance" ON public.match_attendance FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage goals" ON public.goals FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT ON public.tournaments, public.divisions, public.teams, public.division_teams, public.matches, public.goals TO anon, authenticated;
GRANT SELECT ON public.players, public.rosters, public.match_attendance TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tournaments, public.divisions, public.teams, public.players, public.division_teams, public.rosters, public.matches, public.match_attendance, public.goals TO authenticated;
