import { ApiError, body, json, requireChoice, requireInteger, requireText, sameOrigin, type BindValue, type Env, type Statement } from './types';
import { changePassword, createOrganiser, login, logout, requireAdmin, viewer } from './auth';

const id = () => crypto.randomUUID();
const optional = (value: unknown, label: string, max = 200): string | null => value == null || value === '' ? null : requireText(value, label, max);
const date = (value: unknown, label: string): string => { const result = requireText(value, label, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) throw new ApiError(400, `Invalid ${label}`); return result; };
const colour = (value: unknown): string | null => { const result = optional(value, 'colour', 7); if (result && !/^#[a-fA-F0-9]{6}$/.test(result)) throw new ApiError(400, 'Invalid colour'); return result; };
const record = (value: unknown, label: string): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, `${label} must be an object`); return value as Record<string, unknown>; };
const array = (value: unknown, label: string, max = 500): unknown[] => { if (!Array.isArray(value) || value.length > max) throw new ApiError(400, `Invalid ${label}`); return value; };
const uuid = (value: unknown, label: string): string => { const result = requireText(value, label, 36); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) throw new ApiError(400, `Invalid ${label}`); return result; };
const field = (value: unknown, allowed: readonly string[], label: string): string => requireChoice(value, label, allowed);
const q = (env: Env, sql: string, ...values: BindValue[]): Statement => env.DB.prepare(sql).bind(...values);
const kindFor = (category: string) => category === 'regional' ? 'region' : category;

async function bootstrap(env: Env, privateView: boolean) {
  const permitted = privateView ? '' : " WHERE t.status IN ('published','completed')";
  const data = await Promise.all([
    env.DB.prepare(`SELECT t.* FROM tournaments t${permitted} ORDER BY t.starts_on DESC`).all(),
    env.DB.prepare(`SELECT d.* FROM divisions d JOIN tournaments t ON t.id=d.tournament_id${permitted}`).all(),
    env.DB.prepare(`SELECT DISTINCT tm.* FROM teams tm JOIN division_teams dt ON dt.team_id=tm.id JOIN divisions d ON d.id=dt.division_id JOIN tournaments t ON t.id=d.tournament_id${permitted}`).all(),
    env.DB.prepare(`SELECT dt.* FROM division_teams dt JOIN divisions d ON d.id=dt.division_id JOIN tournaments t ON t.id=d.tournament_id${permitted}`).all(),
    env.DB.prepare(`SELECT m.* FROM matches m JOIN divisions d ON d.id=m.division_id JOIN tournaments t ON t.id=d.tournament_id${permitted}`).all(),
    env.DB.prepare(`SELECT DISTINCT o.* FROM organisations o JOIN teams tm ON tm.organisation_id=o.id JOIN division_teams dt ON dt.team_id=tm.id JOIN divisions d ON d.id=dt.division_id JOIN tournaments t ON t.id=d.tournament_id${permitted} ORDER BY o.name`).all(),
  ]);
  const [tournaments, divisions, teams, entries, matches, organisations] = data.map(result => result.results);
  if (!privateView) return { tournaments, divisions, teams, entries, matches, organisations, players: [], rosters: [], attendance: [], goals: [] };
  const [players, rosters, attendance, goals] = await Promise.all([
    env.DB.prepare('SELECT * FROM players').all(), env.DB.prepare('SELECT * FROM rosters').all(),
    env.DB.prepare('SELECT * FROM match_attendance').all(), env.DB.prepare('SELECT * FROM goals').all(),
  ]);
  return { tournaments, divisions, teams, entries, matches, organisations, players: players.results, rosters: rosters.results, attendance: attendance.results, goals: goals.results };
}

function organisationStatements(env: Env, kind: string, name: string): Statement {
  return q(env, 'INSERT OR IGNORE INTO organisations (id, kind, name) VALUES (?, ?, ?)', id(), kind, name);
}
function teamStatements(env: Env, divisionId: string, input: Record<string, unknown>, kind: string, group: string, seed: number): Statement[] {
  const name = requireText(input.name, 'Team name');
  const organisation = requireText(input.organisation, 'Organisation');
  const teamId = id();
  return [organisationStatements(env, kind, organisation),
    q(env, `INSERT INTO teams (id,name,organisation_id,colour) VALUES (?,?,(SELECT id FROM organisations WHERE kind=? AND name=? COLLATE NOCASE),?)`, teamId, name, kind, organisation, colour(input.colour)),
    q(env, 'INSERT INTO division_teams (id,division_id,team_id,group_name,seed) VALUES (?,?,?,?,?)', id(), divisionId, teamId, group, seed)];
}
async function createTournament(env: Env, input: Record<string, unknown>) {
  const tournamentId = id();
  const category = field(input.category, ['school','regional','club'], 'category');
  const start = date(input.starts_on, 'First day'); const end = date(input.ends_on, 'Last day');
  if (end < start) throw new ApiError(400, 'Last day must follow first day');
  const divisions = array(input.divisions, 'divisions', 30).map((value, index) => record(value, `Division ${index + 1}`));
  if (!divisions.length) throw new ApiError(400, 'At least one division is required');
  const statements = [q(env, 'INSERT INTO tournaments (id,name,category,starts_on,ends_on,venue,court_count) VALUES (?,?,?,?,?,?,?)',
    tournamentId, requireText(input.name, 'Tournament name'), category, start, end, optional(input.venue, 'Venue'), requireInteger(input.court_count, 'courts', 1, 20))];
  const divisionNames = new Set<string>();
  for (const draft of divisions) {
    const divisionId = id(); const name = requireText(draft.name, 'Division name');
    if (divisionNames.has(name.toLowerCase())) throw new ApiError(400, 'Duplicate division name'); divisionNames.add(name.toLowerCase());
    const pools = requireInteger(draft.group_count, 'pools', 1, 2);
    const robin = requireInteger(draft.round_robins, 'round robins', 1, 2);
    const finals = field(draft.finals_format, ['none','top_two','top_four','two_pool_crossover','manual'], 'finals format');
    if (pools === 1 && finals === 'two_pool_crossover') throw new ApiError(400, 'Crossover finals need two pools');
    const teamDrafts = array(draft.teams, 'teams', 100).map((value, index) => record(value, `Team ${index + 1}`));
    if (teamDrafts.length < 2) throw new ApiError(400, 'Each division needs at least two teams');
    const teamNames = new Set<string>(); const poolCounts = { A: 0, B: 0 };
    statements.push(q(env, 'INSERT INTO divisions (id,tournament_id,name,group_count,round_robins,finals_format) VALUES (?,?,?,?,?,?)', divisionId, tournamentId, name, pools, robin, finals));
    for (const team of teamDrafts) {
      const teamName = requireText(team.name, 'Team name');
      if (teamNames.has(teamName.toLowerCase())) throw new ApiError(400, `Duplicate team in ${name}`); teamNames.add(teamName.toLowerCase());
      const group = pools === 1 ? 'A' : field(team.group_name, ['A','B'], 'pool') as 'A' | 'B';
      poolCounts[group]++;
      statements.push(...teamStatements(env, divisionId, team, kindFor(category), group, poolCounts[group]));
    }
    if (pools === 2 && (poolCounts.A < 2 || poolCounts.B < 2)) throw new ApiError(400, 'Each pool needs at least two teams');
    if (finals === 'two_pool_crossover' && (poolCounts.A < 3 || poolCounts.B < 3)) throw new ApiError(400, 'Crossover finals need three teams per pool');
    if (finals === 'top_four' && teamDrafts.length < 4) throw new ApiError(400, 'Top-four finals need four teams');
  }
  await env.DB.batch(statements);
  return json({ id: tournamentId }, 201);
}
async function createTeam(env: Env, input: Record<string, unknown>) {
  const divisionId = uuid(input.division_id, 'division');
  const division = await q(env, 'SELECT d.group_count, t.category FROM divisions d JOIN tournaments t ON t.id=d.tournament_id WHERE d.id=?', divisionId).first<{ group_count: number; category: string }>();
  if (!division) throw new ApiError(404, 'Division not found');
  const group = division.group_count === 1 ? 'A' : field(input.group_name, ['A','B'], 'pool');
  const seed = await q(env, 'SELECT COALESCE(MAX(seed),0)+1 AS value FROM division_teams WHERE division_id=? AND group_name=?', divisionId, group).first<{ value: number }>();
  await env.DB.batch(teamStatements(env, divisionId, input, kindFor(division.category), group, seed?.value || 1));
  return json({ ok: true }, 201);
}
async function createPlayer(env: Env, input: Record<string, unknown>) {
  const entry = uuid(input.division_team_id, 'team'); const playerId = id();
  await env.DB.batch([q(env, 'INSERT INTO players (id,name) VALUES (?,?)', playerId, requireText(input.name, 'Player name')),
    q(env, 'INSERT INTO rosters (id,division_team_id,player_id) VALUES (?,?,?)', id(), entry, playerId)]);
  return json({ ok: true }, 201);
}
const matchColumns = ['division_id','stage','round_number','match_number','scheduled_on','starts_at','court','referee','home_division_team_id','away_division_team_id','home_placeholder','away_placeholder','home_source_match_id','away_source_match_id','home_source_outcome','away_source_outcome','home_score','away_score','status'] as const;
function matchValues(input: Record<string, unknown>): BindValue[] {
  const numberFields = ['round_number','match_number','home_score','away_score'];
  const uuidFields = ['division_id','home_division_team_id','away_division_team_id','home_source_match_id','away_source_match_id'];
  return matchColumns.map(key => {
    const value = input[key];
    if (value == null || value === '') return key === 'stage' ? 'group' : key === 'status' ? 'scheduled' : null;
    if (numberFields.includes(key)) return requireInteger(value, key, key.includes('score') ? 0 : 1, 100000);
    if (uuidFields.includes(key)) return uuid(value, key);
    if (key === 'stage') return field(value, ['group','quarter_final','semi_final','final','placement'], 'stage');
    if (key === 'status') return field(value, ['scheduled','in_progress','completed','forfeited'], 'status');
    if (key === 'home_source_outcome' || key === 'away_source_outcome') return field(value, ['winner','loser'], key);
    if (key === 'scheduled_on') return date(value, key);
    return requireText(value, key, 200);
  });
}
async function createMatches(env: Env, input: Record<string, unknown>) {
  const matches = array(input.matches, 'matches', 500).map((value, index) => record(value, `Match ${index + 1}`));
  if (!matches.length) throw new ApiError(400, 'No matches supplied');
  const statements = matches.map(match => q(env, `INSERT INTO matches (id,${matchColumns.join(',')}) VALUES (${Array(matchColumns.length + 1).fill('?').join(',')})`, match.id == null ? id() : uuid(match.id, 'match id'), ...matchValues(match)));
  await env.DB.batch(statements); return json({ ok: true }, 201);
}
async function createDivision(env: Env, input: Record<string, unknown>) {
  const divisionId = id();
  await q(env, 'INSERT INTO divisions (id,tournament_id,name) VALUES (?,?,?)', divisionId, uuid(input.tournament_id, 'tournament'), requireText(input.name, 'Division name')).run();
  return json({ id: divisionId }, 201);
}
async function update(env: Env, table: string, rowId: string, input: Record<string, unknown>) {
  const allowed: Record<string, string[]> = {
    tournaments: ['status'], divisions: ['group_count','round_robins','finals_format','win_points','draw_points','loss_points'],
    division_teams: ['group_name','seed'], matches: [...matchColumns].filter(key => key !== 'division_id'),
  };
  if (!(table in allowed)) throw new ApiError(404, 'Unknown resource');
  const keys = Object.keys(input);
  if (!keys.length || keys.some(key => !allowed[table].includes(key))) throw new ApiError(400, 'Invalid update');
  const values = keys.map(key => {
    const value = input[key]; if (value == null || value === '') return null;
    if (['group_count','round_robins'].includes(key)) return requireInteger(value, key, 1, 2);
    if (['win_points','draw_points','loss_points'].includes(key)) return requireInteger(value, key, 0, 99);
    if (['seed','round_number','match_number'].includes(key)) return requireInteger(value, key, 1, 100000);
    if (['home_score','away_score'].includes(key)) return requireInteger(value, key, 0, 100000);
    if (['home_division_team_id','away_division_team_id','home_source_match_id','away_source_match_id'].includes(key)) return uuid(value, key);
    if (key === 'status') return field(value, table === 'tournaments' ? ['draft','published','completed'] : ['scheduled','in_progress','completed','forfeited'], 'status');
    if (key === 'group_name') return field(value, ['A','B'], key);
    if (key === 'finals_format') return field(value, ['none','top_two','top_four','two_pool_crossover','manual'], key);
    if (key === 'stage') return field(value, ['group','quarter_final','semi_final','final','placement'], key);
    if (key.endsWith('_source_outcome')) return field(value, ['winner','loser'], key);
    if (key === 'scheduled_on') return date(value, key);
    return requireText(value, key, 200);
  });
  const result = await q(env, `UPDATE ${table} SET ${keys.map(key => `${key}=?`).join(',')}${table === 'matches' || table === 'tournaments' ? ',updated_at=CURRENT_TIMESTAMP' : ''} WHERE id=?`, ...values, uuid(rowId, 'id')).run();
  if (!result.meta.changes) throw new ApiError(404, 'Record not found');
  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url); const path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      sameOrigin(request);
      const user = await viewer(request, env);
      if (request.method === 'GET' && path === '/api/bootstrap') return json({ viewer: user, ...await bootstrap(env, !!user) });
      if (request.method === 'POST' && path === '/api/login') return await login(request, env, await body(request));
      if (request.method === 'POST' && path === '/api/logout') return await logout(request, env);
      if (!user) throw new ApiError(401, 'Sign in required');
      if (request.method === 'POST' && path === '/api/password') return await changePassword(env, user, await body(request));
      if (request.method === 'POST' && path === '/api/users') { requireAdmin(user); return await createOrganiser(env, await body(request)); }
      if (request.method === 'POST' && path === '/api/attendance') {
        const input = await body(request);
        await q(env, 'INSERT OR IGNORE INTO match_attendance (match_id,player_id) VALUES (?,?)', uuid(input.match_id, 'match'), uuid(input.player_id, 'player')).run();
        return json({ ok: true });
      }
      if (request.method === 'DELETE' && path === '/api/attendance') {
        const input = await body(request);
        const matchId = uuid(input.match_id, 'match'); const playerId = uuid(input.player_id, 'player');
        const existingGoals = await q(env, 'SELECT id FROM goals WHERE match_id=? AND player_id=? LIMIT 1', matchId, playerId).first();
        if (existingGoals) throw new ApiError(409, 'Remove recorded goals before clearing attendance');
        await q(env, 'DELETE FROM match_attendance WHERE match_id=? AND player_id=?', matchId, playerId).run();
        return json({ ok: true });
      }
      if (request.method === 'POST' && path === '/api/goals') {
        const input = await body(request); const goalId = id();
        await q(env, 'INSERT INTO goals (id,match_id,player_id,division_team_id) VALUES (?,?,?,?)', goalId, uuid(input.match_id, 'match'), uuid(input.player_id, 'player'), uuid(input.division_team_id, 'team')).run();
        return json({ id: goalId }, 201);
      }
      const goalDelete = path.match(/^\/api\/goals\/([0-9a-f-]+)$/);
      if (request.method === 'DELETE' && goalDelete) { await q(env, 'DELETE FROM goals WHERE id=?', uuid(goalDelete[1], 'goal')).run(); return json({ ok: true }); }
      if (request.method === 'PATCH' && path.startsWith('/api/matches/')) {
        const input = await body(request);
        if (user.role === 'scorer' && Object.keys(input).some(key => !['home_score','away_score','status'].includes(key))) throw new ApiError(403, 'Only admins can change fixtures');
        return await update(env, 'matches', path.slice('/api/matches/'.length), input);
      }
      requireAdmin(user);
      if (request.method === 'POST' && path === '/api/tournaments') return await createTournament(env, await body(request));
      if (request.method === 'POST' && path === '/api/teams') return await createTeam(env, await body(request));
      if (request.method === 'POST' && path === '/api/players') return await createPlayer(env, await body(request));
      if (request.method === 'POST' && path === '/api/matches') return await createMatches(env, await body(request));
      if (request.method === 'POST' && path === '/api/divisions') return await createDivision(env, await body(request));
      const route = path.match(/^\/api\/(tournaments|divisions|division_teams)\/([0-9a-f-]+)$/);
      if (request.method === 'PATCH' && route) return await update(env, route[1], route[2], await body(request));
      throw new ApiError(404, 'Endpoint not found');
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      console.error('API failure', error);
      return json({ error: 'Request failed. Check the data and try again.' }, 500);
    }
  },
};
