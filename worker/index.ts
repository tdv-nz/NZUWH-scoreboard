import { ApiError, body, json, requireChoice, requireInteger, requireText, sameOrigin, type BindValue, type Env, type Statement } from './types';
import { changePassword, createOrganiser, login, logout, requireAdmin, viewer } from './auth';
import { generateSchedule, validateScheduleEdit } from './schedule';

const id = () => crypto.randomUUID();
const optional = (value: unknown, label: string, max = 200): string | null => value == null || value === '' ? null : requireText(value, label, max);
const date = (value: unknown, label: string): string => {
  const result = requireText(value, label, 10);
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) throw new ApiError(400, `Invalid ${label}`);
  return result;
};
const time = (value: unknown, label: string): string => {
  const result = requireText(value, label, 5);
  const match = /^(\d{2}):(\d{2})$/.exec(result);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new ApiError(400, `Invalid ${label}`);
  return result;
};
const minutesOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const dateRange = (start: string, end: string) => {
  const dates: string[] = [];
  for (let cursor = new Date(`${start}T00:00:00Z`); cursor <= new Date(`${end}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
    if (dates.length > 500) throw new ApiError(400, 'Tournament date range is too large');
  }
  return dates;
};
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
    env.DB.prepare(`SELECT c.* FROM courts c JOIN tournaments t ON t.id=c.tournament_id${permitted} ORDER BY c.tournament_id,c.display_order`).all(),
  ]);
  const [tournaments, divisions, teams, entries, matches, organisations, courts] = data.map(result => result.results);
  if (!privateView) return { tournaments, divisions, teams, entries, matches, organisations, courts, tournament_days: [], day_breaks: [], schedule_settings: [], court_availability: [], division_court_rules: [], players: [], rosters: [], attendance: [], goals: [] };
  const [players, rosters, attendance, goals, tournamentDays, dayBreaks, scheduleSettings, courtAvailability, divisionCourtRules] = await Promise.all([
    env.DB.prepare('SELECT * FROM players').all(), env.DB.prepare('SELECT * FROM rosters').all(),
    env.DB.prepare('SELECT * FROM match_attendance').all(), env.DB.prepare('SELECT * FROM goals').all(),
    env.DB.prepare('SELECT * FROM tournament_days ORDER BY day_on').all(), env.DB.prepare('SELECT * FROM day_breaks').all(),
    env.DB.prepare('SELECT * FROM schedule_settings').all(), env.DB.prepare('SELECT * FROM court_availability').all(),
    env.DB.prepare('SELECT * FROM division_court_rules ORDER BY preference_order').all(),
  ]);
  return { tournaments, divisions, teams, entries, matches, organisations, courts,
    tournament_days: tournamentDays.results, day_breaks: dayBreaks.results, schedule_settings: scheduleSettings.results,
    court_availability: courtAvailability.results, division_court_rules: divisionCourtRules.results,
    players: players.results, rosters: rosters.results, attendance: attendance.results, goals: goals.results };
}

function organisationStatements(env: Env, kind: string, name: string): Statement {
  return q(env, 'INSERT OR IGNORE INTO organisations (id, kind, name) VALUES (?, ?, ?)', id(), kind, name);
}
function teamStatements(env: Env, divisionId: string, input: Record<string, unknown>, kind: string, group: string, seed: number): Statement[] {
  const name = requireText(input.name, 'Team name');
  const organisation = requireText(input.organisation, 'Organisation');
  const teamId = id();
  const teamColour = colour(input.colour ?? input.team_colour);
  return [organisationStatements(env, kind, organisation),
    q(env, `INSERT INTO teams (id,name,organisation_id,colour) VALUES (?,?,(SELECT id FROM organisations WHERE kind=? AND name=? COLLATE NOCASE),?)
      ON CONFLICT(organisation_id, name COLLATE NOCASE) DO NOTHING`, teamId, name, kind, organisation, teamColour),
    q(env, `INSERT INTO division_teams (id,division_id,team_id,group_name,seed,team_colour)
      VALUES (?,?,(SELECT tm.id FROM teams tm JOIN organisations o ON o.id=tm.organisation_id WHERE o.kind=? AND o.name=? COLLATE NOCASE AND tm.name=? COLLATE NOCASE),?,?,?)`,
      id(), divisionId, kind, organisation, name, group, seed, teamColour)];
}
async function createTournament(env: Env, input: Record<string, unknown>) {
  const tournamentId = id();
  const category = field(input.category, ['school','regional','club'], 'category');
  const start = date(input.starts_on, 'First day'); const end = date(input.ends_on, 'Last day');
  if (end < start) throw new ApiError(400, 'Last day must follow first day');
  const requestedCourtCount = requireInteger(input.court_count, 'courts', 1, 20);
  const courtDrafts = input.courts === undefined
    ? Array.from({ length: requestedCourtCount }, (_, index) => ({ display_name: `Court ${index + 1}`, active: true }))
    : array(input.courts, 'courts', 20).map((value, index) => record(value, `Court ${index + 1}`));
  if (!courtDrafts.length) throw new ApiError(400, 'At least one court is required');
  const courtNames = new Set<string>();
  const courts = courtDrafts.map((draft, index) => {
    const display_name = requireText(draft.display_name ?? draft.name, `Court ${index + 1}`, 80);
    const key = display_name.toLocaleLowerCase();
    if (courtNames.has(key)) throw new ApiError(400, 'Court names must be unique within a tournament');
    courtNames.add(key);
    if (draft.active !== undefined && typeof draft.active !== 'boolean') throw new ApiError(400, `Invalid active status for ${display_name}`);
    return { id: id(), display_name, display_order: index + 1, active: draft.active === false ? 0 : 1 };
  });
  if (!courts.some(court => court.active)) throw new ApiError(400, 'At least one court must be active');
  const courtByName = new Map(courts.map(court => [court.display_name.toLocaleLowerCase(), court]));
  const recordGoalScorers = input.record_goal_scorers === undefined ? false : input.record_goal_scorers;
  if (typeof recordGoalScorers !== 'boolean') throw new ApiError(400, 'Invalid goal-scorer setting');

  const scheduleDraft = input.schedule === undefined ? {} : record(input.schedule, 'Schedule settings');
  const schedule = {
    match_duration_minutes: requireInteger(scheduleDraft.match_duration_minutes ?? 20, 'match duration', 1, 240),
    halftime_minutes: requireInteger(scheduleDraft.halftime_minutes ?? 2, 'halftime duration', 0, 60),
    gap_between_games_minutes: requireInteger(scheduleDraft.gap_between_games_minutes ?? 0, 'gap between games', 0, 180),
    team_turnaround_minutes: requireInteger(scheduleDraft.team_turnaround_minutes ?? 20, 'team turnaround', 0, 720),
  };
  const dayDrafts = input.days === undefined
    ? dateRange(start, end).map(day_on => ({ day_on, available: true, starts_at: '09:00', ends_at: '17:00' }))
    : array(input.days, 'playing days', 500).map((value, index) => record(value, `Playing day ${index + 1}`));
  if (!dayDrafts.length) throw new ApiError(400, 'At least one playing day is required');
  const seenDays = new Set<string>();
  let hasAvailableDay = false;
  const days = dayDrafts.map((draft, index) => {
    const day_on = date(draft.day_on, `Playing day ${index + 1}`);
    if (day_on < start || day_on > end) throw new ApiError(400, 'Playing days must fall within the tournament dates');
    if (seenDays.has(day_on)) throw new ApiError(400, 'Playing days must be unique');
    seenDays.add(day_on);
    if (draft.available !== undefined && typeof draft.available !== 'boolean') throw new ApiError(400, `Invalid availability for ${day_on}`);
    const available = draft.available !== false;
    const starts_at = time(draft.starts_at ?? '09:00', `start time for ${day_on}`);
    const ends_at = time(draft.ends_at ?? '17:00', `finish time for ${day_on}`);
    if (minutesOf(ends_at) <= minutesOf(starts_at)) throw new ApiError(400, `Finish time must follow start time on ${day_on}`);
    if (available) hasAvailableDay = true;
    const breaks = array(draft.breaks ?? [], `breaks for ${day_on}`, 30).map((value, breakIndex) => {
      const item = record(value, `Break ${breakIndex + 1}`);
      const breakStart = time(item.starts_at, 'break start time');
      const breakEnd = time(item.ends_at, 'break finish time');
      if (minutesOf(breakStart) < minutesOf(starts_at) || minutesOf(breakEnd) > minutesOf(ends_at) || minutesOf(breakEnd) <= minutesOf(breakStart)) {
        throw new ApiError(400, `Break times must fit within the playing hours on ${day_on}`);
      }
      return { starts_at: breakStart, ends_at: breakEnd, label: optional(item.label, 'Break name', 80) || 'Break' };
    }).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    for (let i = 1; i < breaks.length; i++) if (breaks[i].starts_at < breaks[i - 1].ends_at) throw new ApiError(400, `Breaks overlap on ${day_on}`);

    const availabilityDrafts = array(draft.court_availability ?? [], `court availability for ${day_on}`, 100).map((value, windowIndex) => record(value, `Court availability ${windowIndex + 1}`));
    const configuredWindows = new Map<string, Array<{ starts_at: string; ends_at: string }>>();
    for (const availability of availabilityDrafts) {
      const courtName = requireText(availability.court_name, 'Court name', 80);
      const court = courtByName.get(courtName.toLocaleLowerCase());
      if (!court || !court.active) throw new ApiError(400, `Availability must reference an active tournament court: ${courtName}`);
      const key = court.display_name.toLocaleLowerCase();
      if (configuredWindows.has(key)) throw new ApiError(400, `Duplicate availability settings for ${court.display_name} on ${day_on}`);
      const windows = array(availability.windows ?? [], `availability windows for ${courtName}`, 20).map((windowValue, windowIndex) => {
        const window = record(windowValue, `Availability window ${windowIndex + 1}`);
        const windowStart = time(window.starts_at, 'court availability start time');
        const windowEnd = time(window.ends_at, 'court availability finish time');
        if (minutesOf(windowStart) < minutesOf(starts_at) || minutesOf(windowEnd) > minutesOf(ends_at) || minutesOf(windowEnd) <= minutesOf(windowStart)) {
          throw new ApiError(400, `Court availability for ${courtName} must fit within the playing hours on ${day_on}`);
        }
        return { starts_at: windowStart, ends_at: windowEnd };
      }).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      for (let i = 1; i < windows.length; i++) if (windows[i].starts_at < windows[i - 1].ends_at) throw new ApiError(400, `Court availability overlaps for ${courtName} on ${day_on}`);
      configuredWindows.set(key, windows);
    }
    if (!available && [...configuredWindows.values()].some(windows => windows.length)) throw new ApiError(400, `A non-playing day cannot have court availability: ${day_on}`);
    return { id: id(), day_on, available: available ? 1 : 0, starts_at, ends_at, breaks, configuredWindows };
  });
  if (!hasAvailableDay) throw new ApiError(400, 'At least one playing day must be available');

  const divisions = array(input.divisions, 'divisions', 30).map((value, index) => record(value, `Division ${index + 1}`));
  if (!divisions.length) throw new ApiError(400, 'At least one division is required');
  const statements = [q(env, 'INSERT INTO tournaments (id,name,category,starts_on,ends_on,venue,court_count,record_goal_scorers) VALUES (?,?,?,?,?,?,?,?)',
    tournamentId, requireText(input.name, 'Tournament name'), category, start, end, optional(input.venue, 'Venue'), courts.filter(court => court.active).length, recordGoalScorers ? 1 : 0)];
  statements.push(q(env, 'INSERT INTO schedule_settings (tournament_id,match_duration_minutes,halftime_minutes,gap_between_games_minutes,team_turnaround_minutes) VALUES (?,?,?,?,?)',
    tournamentId, schedule.match_duration_minutes, schedule.halftime_minutes, schedule.gap_between_games_minutes, schedule.team_turnaround_minutes));
  for (const court of courts) statements.push(q(env, 'INSERT INTO courts (id,tournament_id,display_name,display_order,active) VALUES (?,?,?,?,?)',
    court.id, tournamentId, court.display_name, court.display_order, court.active));
  for (const day of days) {
    statements.push(q(env, 'INSERT INTO tournament_days (id,tournament_id,day_on,available,starts_at,ends_at) VALUES (?,?,?,?,?,?)',
      day.id, tournamentId, day.day_on, day.available, day.starts_at, day.ends_at));
    for (const item of day.breaks) statements.push(q(env, 'INSERT INTO day_breaks (id,tournament_day_id,starts_at,ends_at,label) VALUES (?,?,?,?,?)',
      id(), day.id, item.starts_at, item.ends_at, item.label));
    if (day.available) for (const court of courts.filter(item => item.active)) {
      const windows = day.configuredWindows.has(court.display_name.toLocaleLowerCase())
        ? day.configuredWindows.get(court.display_name.toLocaleLowerCase())!
        : [{ starts_at: day.starts_at, ends_at: day.ends_at }];
      for (const window of windows) statements.push(q(env, 'INSERT INTO court_availability (id,tournament_id,court_id,day_on,starts_at,ends_at) VALUES (?,?,?,?,?,?)',
        id(), tournamentId, court.id, day.day_on, window.starts_at, window.ends_at));
    }
  }
  const divisionNames = new Set<string>();
  for (const draft of divisions) {
    const divisionId = id(); const name = requireText(draft.name, 'Division name');
    if (divisionNames.has(name.toLowerCase())) throw new ApiError(400, 'Duplicate division name'); divisionNames.add(name.toLowerCase());
    const pools = requireInteger(draft.group_count, 'pools', 1, 2);
    const robin = requireInteger(draft.round_robins, 'round robins', 1, 2);
    const finals = field(draft.finals_format, ['none','top_two','top_four','two_pool_crossover','manual'], 'finals format');
    if (pools === 1 && finals === 'two_pool_crossover') throw new ApiError(400, 'Crossover finals need two pools');
    const courtRule = draft.court_rule === undefined ? { allocation_type: 'any', court_names: [] } : record(draft.court_rule, `Court rule for ${name}`);
    const allocationType = field(courtRule.allocation_type, ['any','required','preferred'], 'court allocation');
    const ruleCourtNames = array(courtRule.court_names ?? [], `court choices for ${name}`, 20).map((value, index) => requireText(value, `Court choice ${index + 1}`, 80));
    const ruleCourtKeys = new Set(ruleCourtNames.map(value => value.toLocaleLowerCase()));
    if (ruleCourtKeys.size !== ruleCourtNames.length) throw new ApiError(400, `Court choices for ${name} must be unique`);
    if (allocationType === 'any' && ruleCourtNames.length) throw new ApiError(400, `Any-court division ${name} cannot list restricted courts`);
    if (allocationType !== 'any' && !ruleCourtNames.length) throw new ApiError(400, `${allocationType === 'required' ? 'Required' : 'Preferred'} court rules need at least one court for ${name}`);
    const ruleCourts = ruleCourtNames.map(courtName => {
      const court = courtByName.get(courtName.toLocaleLowerCase());
      if (!court || !court.active) throw new ApiError(400, `Court rule for ${name} must use active tournament courts`);
      return court;
    });
    const teamDrafts = array(draft.teams, 'teams', 100).map((value, index) => record(value, `Team ${index + 1}`));
    if (teamDrafts.length < 2) throw new ApiError(400, 'Each division needs at least two teams');
    const teamNames = new Set<string>(); const poolCounts = { A: 0, B: 0 };
    statements.push(q(env, 'INSERT INTO divisions (id,tournament_id,name,group_count,round_robins,finals_format) VALUES (?,?,?,?,?,?)', divisionId, tournamentId, name, pools, robin, finals));
    ruleCourts.forEach((court, index) => statements.push(q(env, 'INSERT INTO division_court_rules (id,division_id,court_id,allocation_type,preference_order) VALUES (?,?,?,?,?)',
      id(), divisionId, court.id, allocationType, index + 1)));
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
const matchColumns = ['division_id','stage','round_number','match_number','scheduled_on','starts_at','court_id','court','referee','home_division_team_id','away_division_team_id','home_placeholder','away_placeholder','home_source_match_id','away_source_match_id','home_source_outcome','away_source_outcome','home_score','away_score','status'] as const;
function matchValues(input: Record<string, unknown>): BindValue[] {
  const numberFields = ['round_number','match_number','home_score','away_score'];
  const uuidFields = ['division_id','court_id','home_division_team_id','away_division_team_id','home_source_match_id','away_source_match_id'];
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
async function updateDivisionCourtRules(env: Env, divisionId: string, input: Record<string, unknown>) {
  const division = await q(env, `SELECT d.tournament_id,t.status FROM divisions d JOIN tournaments t ON t.id=d.tournament_id WHERE d.id=?`, divisionId)
    .first<{ tournament_id: string; status: string }>();
  if (!division) throw new ApiError(404, 'Division not found');
  if (division.status !== 'draft') throw new ApiError(409, 'Court rules can only change before the tournament is published');
  const allocationType = field(input.allocation_type, ['any','required','preferred'], 'court allocation');
  const courtIds = array(input.court_ids ?? [], 'court choices', 20).map((value, index) => uuid(value, `Court ${index + 1}`));
  if (new Set(courtIds).size !== courtIds.length) throw new ApiError(400, 'Court choices must be unique');
  if (allocationType === 'any' && courtIds.length) throw new ApiError(400, 'Any-court rules cannot list restricted courts');
  if (allocationType !== 'any' && !courtIds.length) throw new ApiError(400, 'Choose at least one court for this rule');
  if (courtIds.length) {
    const placeholders = courtIds.map(() => '?').join(',');
    const result = await q(env, `SELECT id FROM courts WHERE tournament_id=? AND active=1 AND id IN (${placeholders})`, division.tournament_id, ...courtIds).all();
    if (result.results.length !== courtIds.length) throw new ApiError(400, 'Court rules must use active courts from this tournament');
  }
  const statements = [q(env, 'DELETE FROM division_court_rules WHERE division_id=?', divisionId)];
  courtIds.forEach((courtId, index) => statements.push(q(env,
    'INSERT INTO division_court_rules (id,division_id,court_id,allocation_type,preference_order) VALUES (?,?,?,?,?)',
    id(), divisionId, courtId, allocationType, index + 1)));
  await env.DB.batch(statements);
  return json({ ok: true });
}
async function update(env: Env, table: string, rowId: string, input: Record<string, unknown>, scheduleDiagnostics?: { issue: string | null; warning: string | null }) {
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
    if (['court_id','home_division_team_id','away_division_team_id','home_source_match_id','away_source_match_id'].includes(key)) return uuid(value, key);
    if (key === 'status') return field(value, table === 'tournaments' ? ['draft','published','completed'] : ['scheduled','in_progress','completed','forfeited'], 'status');
    if (key === 'group_name') return field(value, ['A','B'], key);
    if (key === 'finals_format') return field(value, ['none','top_two','top_four','two_pool_crossover','manual'], key);
    if (key === 'stage') return field(value, ['group','quarter_final','semi_final','final','placement'], key);
    if (key.endsWith('_source_outcome')) return field(value, ['winner','loser'], key);
    if (key === 'scheduled_on') return date(value, key);
    return requireText(value, key, 200);
  });
  const diagnosticSql = table === 'matches' && scheduleDiagnostics ? ',schedule_issue=?,schedule_warning=?' : '';
  const diagnosticValues: BindValue[] = table === 'matches' && scheduleDiagnostics ? [scheduleDiagnostics.issue, scheduleDiagnostics.warning] : [];
  const result = await q(env, `UPDATE ${table} SET ${keys.map(key => `${key}=?`).join(',')}${diagnosticSql}${table === 'matches' || table === 'tournaments' ? ',updated_at=CURRENT_TIMESTAMP' : ''} WHERE id=?`, ...values, ...diagnosticValues, uuid(rowId, 'id')).run();
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
        const matchId = uuid(path.slice('/api/matches/'.length), 'match');
        if (user.role === 'admin' && ['scheduled_on','starts_at','court_id'].some(key => Object.hasOwn(input, key))) {
          const { confirm_warnings, ...changes } = input;
          if (confirm_warnings !== undefined && typeof confirm_warnings !== 'boolean') throw new ApiError(400, 'Invalid warning confirmation');
          const validation = await validateScheduleEdit(env, matchId, changes, confirm_warnings === true);
          if (validation.warnings.length && confirm_warnings !== true) {
            return json({ error: 'Confirm these scheduling warnings before saving.', warnings: validation.warnings, requires_confirmation: true }, 409);
          }
          if (validation.court !== undefined) changes.court = validation.court;
          return await update(env, 'matches', matchId, changes, { issue: validation.issue ?? null, warning: validation.warning ?? null });
        }
        return await update(env, 'matches', matchId, input);
      }
      requireAdmin(user);
      const schedule = path.match(/^\/api\/tournaments\/([0-9a-f-]+)\/schedule\/generate$/);
      if (request.method === 'POST' && schedule) return await generateSchedule(env, uuid(schedule[1], 'tournament'));
      const courtRules = path.match(/^\/api\/divisions\/([0-9a-f-]+)\/court-rules$/);
      if (request.method === 'PUT' && courtRules) return await updateDivisionCourtRules(env, uuid(courtRules[1], 'division'), await body(request));
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
