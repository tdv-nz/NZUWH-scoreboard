-- Tournament setup is saved as one transaction, including its divisions and teams.
ALTER TABLE public.tournaments
  ADD COLUMN court_count integer NOT NULL DEFAULT 1 CHECK (court_count BETWEEN 1 AND 20);

ALTER TABLE public.divisions
  ADD COLUMN finals_format text NOT NULL DEFAULT 'manual'
  CHECK (finals_format IN ('none', 'top_two', 'top_four', 'two_pool_crossover', 'manual'));

CREATE FUNCTION public.create_tournament(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tournament_id uuid;
  v_division_id uuid;
  v_team_id uuid;
  division_data jsonb;
  team_data jsonb;
  grade_name text;
  team_name text;
  pool_name text;
  pool_count integer;
  finals text;
  pool_seed integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  IF coalesce(jsonb_typeof(_payload->'divisions'), '') <> 'array' THEN
    RAISE EXCEPTION 'Divisions must be an array';
  END IF;
  IF jsonb_array_length(_payload->'divisions') = 0 THEN
    RAISE EXCEPTION 'Choose at least one division';
  END IF;
  INSERT INTO public.tournaments (name, category, starts_on, ends_on, venue, court_count)
  VALUES (
    trim(_payload->>'name'), _payload->>'category',
    (_payload->>'starts_on')::date, (_payload->>'ends_on')::date,
    nullif(trim(_payload->>'venue'), ''), (_payload->>'court_count')::integer
  ) RETURNING id INTO v_tournament_id;

  FOR division_data IN SELECT value FROM jsonb_array_elements(_payload->'divisions') LOOP
    grade_name := trim(division_data->>'name');
    pool_count := (division_data->>'group_count')::integer;
    finals := division_data->>'finals_format';
    IF coalesce(jsonb_typeof(division_data->'teams'), '') <> 'array' THEN
      RAISE EXCEPTION 'Division % teams must be an array', grade_name;
    END IF;
    IF jsonb_array_length(division_data->'teams') < 2 THEN
      RAISE EXCEPTION 'Division % needs at least two teams', grade_name;
    END IF;
    IF finals = 'two_pool_crossover' AND pool_count <> 2 THEN
      RAISE EXCEPTION 'Crossover finals require two pools';
    END IF;
    IF finals IN ('top_two', 'top_four') AND pool_count <> 1 THEN
      RAISE EXCEPTION 'Top-two and top-four finals require one pool';
    END IF;
    INSERT INTO public.divisions (tournament_id, name, group_count, round_robins, finals_format)
    VALUES (v_tournament_id, grade_name, pool_count, (division_data->>'round_robins')::integer, finals)
    RETURNING id INTO v_division_id;

    FOR team_data IN SELECT value FROM jsonb_array_elements(division_data->'teams') LOOP
      team_name := trim(team_data->>'name');
      pool_name := CASE WHEN pool_count = 1 THEN 'A' ELSE team_data->>'group_name' END;
      IF team_name IS NULL OR team_name = '' THEN RAISE EXCEPTION 'Team name is required'; END IF;
      IF pool_name NOT IN ('A', 'B') OR pool_name IS NULL THEN RAISE EXCEPTION 'Choose pool A or B'; END IF;
      IF EXISTS (
        SELECT 1 FROM public.division_teams dt JOIN public.teams t ON t.id = dt.team_id
        WHERE dt.division_id = v_division_id AND lower(t.name) = lower(team_name)
      ) THEN RAISE EXCEPTION 'Duplicate team % in division %', team_name, grade_name; END IF;
      SELECT count(*) + 1 INTO pool_seed FROM public.division_teams
      WHERE division_id = v_division_id AND group_name = pool_name;
      INSERT INTO public.teams (name, organisation, colour)
      VALUES (team_name, nullif(trim(team_data->>'organisation'), ''), team_data->>'colour')
      RETURNING id INTO v_team_id;
      INSERT INTO public.division_teams (division_id, team_id, group_name, seed)
      VALUES (v_division_id, v_team_id, pool_name, pool_seed);
    END LOOP;
    IF pool_count = 2 AND (
      (SELECT count(*) FROM public.division_teams WHERE division_id = v_division_id AND group_name = 'A') < 2 OR
      (SELECT count(*) FROM public.division_teams WHERE division_id = v_division_id AND group_name = 'B') < 2
    ) THEN RAISE EXCEPTION 'Each pool in % needs at least two teams', grade_name; END IF;
    IF finals = 'two_pool_crossover' AND (
      (SELECT count(*) FROM public.division_teams WHERE division_id = v_division_id AND group_name = 'A') < 3 OR
      (SELECT count(*) FROM public.division_teams WHERE division_id = v_division_id AND group_name = 'B') < 3
    ) THEN RAISE EXCEPTION 'Crossover finals need at least three teams in each pool'; END IF;
    IF finals = 'top_four' AND jsonb_array_length(division_data->'teams') < 4 THEN
      RAISE EXCEPTION 'Top-four finals need at least four teams';
    END IF;
  END LOOP;
  RETURN v_tournament_id;
END $$;

REVOKE ALL ON FUNCTION public.create_tournament(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tournament(jsonb) TO authenticated;
