-- Schools, regions, and clubs are reusable across tournaments and divisions.
CREATE TABLE public.organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('school', 'region', 'club')),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organisations_kind_name_idx ON public.organisations (kind, lower(name));
ALTER TABLE public.teams ADD COLUMN organisation_id uuid REFERENCES public.organisations(id) ON DELETE RESTRICT;

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read organisations" ON public.organisations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins manage organisations" ON public.organisations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.organisations TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.organisations TO authenticated;

-- Preserve teams created before this migration and link any named organisations.
INSERT INTO public.organisations (kind, name)
SELECT DISTINCT ON (kind, lower(name)) kind, name
FROM (
  SELECT CASE tr.category WHEN 'regional' THEN 'region' ELSE tr.category END AS kind,
    btrim(t.organisation) AS name
  FROM public.teams t
  JOIN public.division_teams dt ON dt.team_id = t.id
  JOIN public.divisions d ON d.id = dt.division_id
  JOIN public.tournaments tr ON tr.id = d.tournament_id
  WHERE t.organisation IS NOT NULL AND btrim(t.organisation) <> ''
) existing
ORDER BY kind, lower(name), name;

UPDATE public.teams t SET organisation_id = o.id
FROM public.division_teams dt
JOIN public.divisions d ON d.id = dt.division_id
JOIN public.tournaments tr ON tr.id = d.tournament_id
JOIN public.organisations o ON o.kind = CASE tr.category WHEN 'regional' THEN 'region' ELSE tr.category END
WHERE dt.team_id = t.id AND lower(o.name) = lower(btrim(t.organisation)) AND t.organisation_id IS NULL;

-- New team entries must have a matching school, region, or club. The original
-- tournament creation function inserts the team before its division entry, so
-- the link is resolved here inside the same transaction.
CREATE FUNCTION public.link_team_organisation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_kind text;
  v_name text;
  v_org_id uuid;
  v_existing_kind text;
BEGIN
  SELECT CASE tr.category WHEN 'regional' THEN 'region' ELSE tr.category END
    INTO v_kind
  FROM public.divisions d JOIN public.tournaments tr ON tr.id = d.tournament_id
  WHERE d.id = NEW.division_id;
  SELECT btrim(t.organisation), t.organisation_id INTO v_name, v_org_id
  FROM public.teams t WHERE t.id = NEW.team_id;
  IF v_org_id IS NULL THEN
    IF v_name IS NULL OR v_name = '' THEN
      RAISE EXCEPTION 'A % is required for every team', v_kind;
    END IF;
    INSERT INTO public.organisations (kind, name) VALUES (v_kind, v_name)
      ON CONFLICT (kind, lower(name)) DO NOTHING;
    SELECT id INTO v_org_id FROM public.organisations
      WHERE kind = v_kind AND lower(name) = lower(v_name);
    UPDATE public.teams SET organisation_id = v_org_id WHERE id = NEW.team_id;
  ELSE
    SELECT kind INTO v_existing_kind FROM public.organisations WHERE id = v_org_id;
    IF v_existing_kind <> v_kind THEN
      RAISE EXCEPTION 'Team organisation must be a %', v_kind;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER link_team_organisation_before_write
  BEFORE INSERT OR UPDATE OF division_id, team_id ON public.division_teams
  FOR EACH ROW EXECUTE FUNCTION public.link_team_organisation();
