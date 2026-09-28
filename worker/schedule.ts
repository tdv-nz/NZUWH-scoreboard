import { ApiError, json, type BindValue, type Env, type Statement } from './types';

type Tournament = { id: string; starts_on: string; ends_on: string };
type Court = { id: string; display_name: string; display_order: number; active: number };
type Day = { day_on: string; available: number };
type Break = { day_on: string; starts_at: string; ends_at: string; label: string };
type Availability = { court_id: string; day_on: string; starts_at: string; ends_at: string };
type Rule = { division_id: string; court_id: string; allocation_type: 'required' | 'preferred'; preference_order: number };
type Settings = { match_duration_minutes: number; halftime_minutes: number; gap_between_games_minutes: number; team_turnaround_minutes: number };
type Match = {
  id: string; division_id: string; stage: string; match_number: number | null; status: string;
  scheduled_on: string | null; starts_at: string | null; court_id: string | null; court: string | null;
  home_division_team_id: string | null; away_division_team_id: string | null;
  home_source_match_id: string | null; away_source_match_id: string | null;
  home_score: number | null; away_score: number | null;
};
type Context = {
  tournament: Tournament; courts: Court[]; days: Day[]; breaks: Break[]; availability: Availability[];
  rules: Rule[]; settings: Settings; matches: Match[];
};
type Assignment = { match: Match; day_on: string; starts_at: string; court: Court };
type Interval = { match_id: string; start: number; end: number; teamIds: string[]; courtId: string };
type Slot = { day_on: string; starts_at: string; minute: number; start: number; court: Court };

const q = (env: Env, sql: string, ...values: BindValue[]): Statement => env.DB.prepare(sql).bind(...values);
const minutesOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validTime = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const dayNumber = (value: string) => Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
const absoluteMinute = (day: string, minute: number) => dayNumber(day) * 1440 + minute;
const fmtTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const teamsFor = (match: Match) => [match.home_division_team_id, match.away_division_team_id].filter((value): value is string => !!value);
const playingDuration = (settings: Settings) => settings.match_duration_minutes + settings.halftime_minutes;

async function contextFor(env: Env, tournamentId: string): Promise<Context> {
  const tournament = await q(env, 'SELECT id,starts_on,ends_on FROM tournaments WHERE id=?', tournamentId).first<Tournament>();
  if (!tournament) throw new ApiError(404, 'Tournament not found');
  const [courts, days, breaks, availability, rules, settings, matches] = await Promise.all([
    q(env, 'SELECT id,display_name,display_order,active FROM courts WHERE tournament_id=? ORDER BY display_order', tournamentId).all<Court>(),
    q(env, 'SELECT day_on,available FROM tournament_days WHERE tournament_id=? ORDER BY day_on', tournamentId).all<Day>(),
    q(env, 'SELECT d.day_on,b.starts_at,b.ends_at,b.label FROM day_breaks b JOIN tournament_days d ON d.id=b.tournament_day_id WHERE d.tournament_id=? ORDER BY d.day_on,b.starts_at', tournamentId).all<Break>(),
    q(env, 'SELECT court_id,day_on,starts_at,ends_at FROM court_availability WHERE tournament_id=? ORDER BY day_on,starts_at', tournamentId).all<Availability>(),
    q(env, 'SELECT r.division_id,r.court_id,r.allocation_type,r.preference_order FROM division_court_rules r JOIN divisions d ON d.id=r.division_id WHERE d.tournament_id=? ORDER BY r.division_id,r.preference_order', tournamentId).all<Rule>(),
    q(env, 'SELECT match_duration_minutes,halftime_minutes,gap_between_games_minutes,team_turnaround_minutes FROM schedule_settings WHERE tournament_id=?', tournamentId).first<Settings>(),
    q(env, `SELECT m.*,d.tournament_id FROM matches m JOIN divisions d ON d.id=m.division_id WHERE d.tournament_id=? ORDER BY m.match_number,m.id`, tournamentId).all<Match>(),
  ]);
  return {
    tournament, courts: courts.results, days: days.results, breaks: breaks.results,
    availability: availability.results, rules: rules.results,
    settings: settings || { match_duration_minutes: 20, halftime_minutes: 2, gap_between_games_minutes: 0, team_turnaround_minutes: 20 },
    matches: matches.results,
  };
}

function ruleFor(context: Context, divisionId: string) {
  return context.rules.filter(rule => rule.division_id === divisionId).sort((a, b) => a.preference_order - b.preference_order);
}

function buildSlots(context: Context): Slot[] {
  const duration = playingDuration(context.settings);
  const courtMap = new Map(context.courts.filter(court => court.active).map(court => [court.id, court]));
  const dayMap = new Map(context.days.map(day => [day.day_on, day]));
  const breakMap = new Map<string, Break[]>();
  for (const item of context.breaks) breakMap.set(item.day_on, [...(breakMap.get(item.day_on) || []), item]);
  const slots: Slot[] = [];
  const seen = new Set<string>();
  for (const window of context.availability) {
    const court = courtMap.get(window.court_id);
    if (!court || dayMap.get(window.day_on)?.available !== 1) continue;
    const from = minutesOf(window.starts_at); const until = minutesOf(window.ends_at);
    for (let start = from; start + duration <= until; start += 5) {
      const end = start + duration;
      if ((breakMap.get(window.day_on) || []).some(item => start < minutesOf(item.ends_at) && end > minutesOf(item.starts_at))) continue;
      const key = `${court.id}|${window.day_on}|${start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push({ day_on: window.day_on, starts_at: fmtTime(start), minute: start, start: absoluteMinute(window.day_on, start), court });
    }
  }
  return slots.sort((a, b) => a.start - b.start || a.court.display_order - b.court.display_order);
}

function teamTurnaroundConflict(start: number, duration: number, other: Interval, turnaround: number) {
  const end = start + duration;
  return start < other.end + turnaround && other.start < end + turnaround;
}
function courtConflict(start: number, duration: number, other: Interval, gap: number) {
  const end = start + duration;
  return start < other.end + gap && other.start < end + gap;
}

function currentIntervals(context: Context, skipMatchId?: string): Interval[] {
  const duration = playingDuration(context.settings);
  return context.matches.flatMap(match => {
    if (match.id === skipMatchId || !match.scheduled_on || !match.starts_at || !validDate(match.scheduled_on) || !validTime(match.starts_at)) return [];
    const court = match.court_id || context.courts.find(item => item.display_name.toLowerCase() === (match.court || '').toLowerCase())?.id;
    if (!court) return [];
    return [{ match_id: match.id, start: absoluteMinute(match.scheduled_on, minutesOf(match.starts_at)),
      end: absoluteMinute(match.scheduled_on, minutesOf(match.starts_at)) + duration,
      teamIds: teamsFor(match), courtId: court }];
  });
}

export async function generateSchedule(env: Env, tournamentId: string): Promise<Response> {
  const context = await contextFor(env, tournamentId);
  if (!context.matches.length) throw new ApiError(400, 'Generate fixtures before building the schedule.');
  const hasResults = context.matches.some(match => match.status !== 'scheduled' || match.home_score !== null || match.away_score !== null);
  const matchesToPlace = hasResults
    ? context.matches.filter(match => match.status === 'scheduled' && match.home_score === null && match.away_score === null
      && (!match.scheduled_on || !match.starts_at || !match.court_id))
    : context.matches;
  if (hasResults && !matchesToPlace.length) {
    throw new ApiError(409, 'The schedule cannot be rebuilt after a match has started or a result has been recorded.');
  }
  const slots = buildSlots(context);
  const rulesByDivision = new Map<string, Rule[]>();
  for (const match of context.matches) rulesByDivision.set(match.division_id, ruleFor(context, match.division_id));
  const rankFor = (match: Match, courtId: string) => {
    const rules = rulesByDivision.get(match.division_id) || [];
    if (!rules.length) return 0;
    const matchRule = rules[0];
    const position = rules.findIndex(rule => rule.court_id === courtId);
    if (matchRule.allocation_type === 'required') return position < 0 ? Number.POSITIVE_INFINITY : 0;
    return position < 0 ? rules.length + 1 : position;
  };
  const slotCounts = new Map<string, number>();
  for (const match of matchesToPlace) {
    slotCounts.set(match.id, slots.filter(slot => rankFor(match, slot.court.id) !== Number.POSITIVE_INFINITY).length);
  }
  const degree = new Map<string, number>();
  for (const match of matchesToPlace) for (const team of new Set(teamsFor(match))) degree.set(team, (degree.get(team) || 0) + 1);
  const matchById = new Map(context.matches.map(match => [match.id, match]));
  const depthMemo = new Map<string, number>();
  const dependencyDepth = (match: Match, visiting = new Set<string>()): number => {
    if (depthMemo.has(match.id)) return depthMemo.get(match.id)!;
    if (visiting.has(match.id)) return 0;
    visiting.add(match.id);
    const depth = Math.max(-1, ...[match.home_source_match_id, match.away_source_match_id]
      .filter((sourceId): sourceId is string => !!sourceId)
      .map(sourceId => matchById.get(sourceId)).filter((source): source is Match => !!source)
      .map(source => dependencyDepth(source, visiting) + 1));
    visiting.delete(match.id); depthMemo.set(match.id, depth); return depth;
  };
  const matches = [...matchesToPlace].sort((a, b) => {
    const aRules = rulesByDivision.get(a.division_id) || []; const bRules = rulesByDivision.get(b.division_id) || [];
    const aType = aRules[0]?.allocation_type === 'required' ? 0 : aRules[0]?.allocation_type === 'preferred' ? 1 : 2;
    const bType = bRules[0]?.allocation_type === 'required' ? 0 : bRules[0]?.allocation_type === 'preferred' ? 1 : 2;
    return aType - bType || dependencyDepth(a) - dependencyDepth(b) || (slotCounts.get(a.id) || 0) - (slotCounts.get(b.id) || 0)
      || Math.max(...teamsFor(b).map(team => degree.get(team) || 0), 0) - Math.max(...teamsFor(a).map(team => degree.get(team) || 0), 0)
      || (a.match_number || 0) - (b.match_number || 0) || a.id.localeCompare(b.id);
  });

  const courtAssignments = new Map<string, Interval[]>();
  const teamAssignments = new Map<string, Interval[]>();
  const dayCounts = new Map<string, number>();
  const placedEnds = new Map<string, number>();
  if (hasResults) {
    const targets = new Set(matchesToPlace.map(match => match.id));
    for (const interval of currentIntervals(context)) {
      if (targets.has(interval.match_id)) continue;
      courtAssignments.set(interval.courtId, [...(courtAssignments.get(interval.courtId) || []), interval]);
      placedEnds.set(interval.match_id, interval.end);
      for (const teamId of interval.teamIds) teamAssignments.set(teamId, [...(teamAssignments.get(teamId) || []), interval]);
      const reservedDate = context.matches.find(match => match.id === interval.match_id)?.scheduled_on;
      if (reservedDate) dayCounts.set(reservedDate, (dayCounts.get(reservedDate) || 0) + 1);
    }
  }
  const assignments: Assignment[] = [];
  const unscheduled: Array<{ match_id: string; reason: string }> = [];
  const duration = playingDuration(context.settings);
  const gap = context.settings.gap_between_games_minutes;
  const turnaround = context.settings.team_turnaround_minutes;
  const progressionBarrier = (match: Match) => {
    const divisionGames = context.matches.filter(item => item.division_id === match.division_id);
    const dependencies = [match.home_source_match_id, match.away_source_match_id].filter((item): item is string => !!item);
    const completedGames = hasResults ? divisionGames.filter(item => item.status === 'completed' || item.status === 'forfeited') : [];
    const ends = completedGames.filter(item => item.scheduled_on && item.starts_at && validDate(item.scheduled_on) && validTime(item.starts_at))
      .map(item => absoluteMinute(item.scheduled_on!, minutesOf(item.starts_at!)) + duration);
    for (const sourceId of dependencies) {
      if (!placedEnds.has(sourceId)) return Number.POSITIVE_INFINITY;
      ends.push(placedEnds.get(sourceId)!);
    }
    return ends.length ? Math.max(...ends) : Number.NEGATIVE_INFINITY;
  };

  for (const match of matches) {
    const usable = slots.filter(slot => rankFor(match, slot.court.id) !== Number.POSITIVE_INFINITY);
    const earliestStart = progressionBarrier(match);
    let blockedByProgression = 0; let blockedByCourt = 0; let blockedByTurnaround = 0; let selected: Slot | undefined; let bestScore = Number.POSITIVE_INFINITY;
    for (const slot of usable) {
      if (slot.start < earliestStart) { blockedByProgression++; continue; }
      const candidate: Interval = { match_id: match.id, start: slot.start, end: slot.start + duration, teamIds: teamsFor(match), courtId: slot.court.id };
      const courtOccupied = courtAssignments.get(slot.court.id) || [];
      if (courtOccupied.some(other => courtConflict(candidate.start, duration, other, gap))) { blockedByCourt++; continue; }
      const candidateTeams = candidate.teamIds.flatMap(team => teamAssignments.get(team) || []);
      if (candidateTeams.some(other => teamTurnaroundConflict(candidate.start, duration, other, turnaround))) { blockedByTurnaround++; continue; }
      const rules = rulesByDivision.get(match.division_id) || [];
      const preferenceRank = rules.length && rules[0].allocation_type === 'preferred' ? rankFor(match, slot.court.id) : 0;
      const teamDayLoad = candidate.teamIds.reduce((sum, team) => sum + (teamAssignments.get(team) || []).filter(item => Math.floor(item.start / 1440) === Math.floor(candidate.start / 1440)).length, 0);
      const adjacent = candidateTeams.some(other => Math.abs(candidate.start - other.end) < 5 || Math.abs(other.start - candidate.end) < 5);
      const score = preferenceRank * 100_000 + (dayCounts.get(slot.day_on) || 0) * 30 + teamDayLoad * 8
        + (adjacent ? 5_000 : 0) + slot.minute * 0.01 + slot.court.display_order * 0.001;
      if (score < bestScore) { bestScore = score; selected = slot; }
    }
    if (!selected) {
      const rules = rulesByDivision.get(match.division_id) || [];
      let reason: string;
      if (!usable.length) reason = rules[0]?.allocation_type === 'required'
        ? 'No required court has an available window long enough for this match.'
        : 'No active court has an available window long enough for this match.';
      else if (blockedByProgression && !blockedByCourt && !blockedByTurnaround) reason = 'This fixture must be scheduled after its completed or linked feeder matches.';
      else if (blockedByProgression && (blockedByCourt || blockedByTurnaround)) reason = 'No valid slot remains after the completed or linked feeder matches and the other schedule constraints.';
      else if (blockedByTurnaround && !blockedByCourt) reason = `No available slot leaves at least ${turnaround} minutes between matches for both teams.`;
      else if (blockedByCourt && blockedByTurnaround) reason = 'Available slots conflict with occupied courts and team turnaround limits.';
      else if (blockedByCourt) reason = 'All available court slots are occupied by another match.';
      else reason = 'No valid court and time slot could be found.';
      unscheduled.push({ match_id: match.id, reason });
      continue;
    }
    const assignment = { match, day_on: selected.day_on, starts_at: selected.starts_at, court: selected.court };
    const interval: Interval = { match_id: match.id, start: selected.start, end: selected.start + duration, teamIds: teamsFor(match), courtId: selected.court.id };
    assignments.push(assignment);
    placedEnds.set(match.id, interval.end);
    courtAssignments.set(selected.court.id, [...(courtAssignments.get(selected.court.id) || []), interval]);
    for (const teamId of interval.teamIds) teamAssignments.set(teamId, [...(teamAssignments.get(teamId) || []), interval]);
    dayCounts.set(selected.day_on, (dayCounts.get(selected.day_on) || 0) + 1);
  }

  const issueByMatch = new Map(unscheduled.map(item => [item.match_id, item.reason]));
  const assignmentByMatch = new Map(assignments.map(item => [item.match.id, item]));
  const warningsByMatch = new Map<string, string | null>();
  const statements = matchesToPlace.map(match => {
    const assignment = assignmentByMatch.get(match.id);
    const issue = issueByMatch.get(match.id) || null;
    const rules = rulesByDivision.get(match.division_id) || [];
    const warning = assignment && rules[0]?.allocation_type === 'preferred' && !rules.some(rule => rule.court_id === assignment.court.id)
      ? `Preferred courts were unavailable; scheduled on ${assignment.court.display_name}.` : null;
    warningsByMatch.set(match.id, warning);
    return q(env, `UPDATE matches SET scheduled_on=?,starts_at=?,court_id=?,court=?,schedule_issue=?,schedule_warning=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      assignment?.day_on ?? null, assignment?.starts_at ?? null, assignment?.court.id ?? null, assignment?.court.display_name ?? null,
      issue, warning, match.id);
  });
  await env.DB.batch(statements);
  return json({
    total: matchesToPlace.length, scheduled: assignments.length, unscheduled,
    fallbacks: [...warningsByMatch.values()].filter(Boolean).length,
    summary: hasResults
      ? `Scheduled ${assignments.length} new fixtures; ${unscheduled.length} still need attention.`
      : `${assignments.length} of ${context.matches.length} matches scheduled; ${unscheduled.length} need attention.`,
  });
}

export async function validateScheduleEdit(env: Env, matchId: string, input: Record<string, unknown>, confirmWarnings: boolean) {
  const match = await q(env, 'SELECT d.tournament_id FROM matches m JOIN divisions d ON d.id=m.division_id WHERE m.id=?', matchId).first<{ tournament_id: string }>();
  if (!match) throw new ApiError(404, 'Match not found');
  const context = await contextFor(env, match.tournament_id);
  const current = context.matches.find(item => item.id === matchId);
  if (!current) throw new ApiError(404, 'Match not found');
  const fields = ['scheduled_on', 'starts_at', 'court_id'];
  const hasAny = fields.some(field => Object.hasOwn(input, field));
  if (!hasAny) return { issue: undefined, warning: undefined, court: undefined, warnings: [] as string[] };
  if (current.status !== 'scheduled' || current.home_score !== null || current.away_score !== null) {
    throw new ApiError(409, 'A match cannot be rescheduled after it starts or a result is recorded.');
  }
  const values = fields.map(field => Object.hasOwn(input, field) ? input[field] : current[field as keyof Match]);
  if (values.every(value => value == null || value === '')) {
    return { issue: 'This fixture is not scheduled yet.', warning: null, court: null, warnings: [] as string[] };
  }
  const [dayValue, timeValue, courtValue] = values;
  if (!validDate(dayValue)) throw new ApiError(400, 'Choose a valid playing date.');
  if (!validTime(timeValue)) throw new ApiError(400, 'Choose a valid start time.');
  if (typeof courtValue !== 'string' || !courtValue) throw new ApiError(400, 'Choose an active court.');
  const day = context.days.find(item => item.day_on === dayValue);
  if (!day || day.available !== 1) throw new ApiError(400, 'That date is not configured as a playing day.');
  const court = context.courts.find(item => item.id === courtValue && item.active);
  if (!court) throw new ApiError(400, 'Choose an active court from this tournament.');
  const start = minutesOf(timeValue); const end = start + playingDuration(context.settings);
  const windows = context.availability.filter(item => item.day_on === dayValue && item.court_id === court.id);
  if (!windows.some(item => start >= minutesOf(item.starts_at) && end <= minutesOf(item.ends_at))) {
    throw new ApiError(400, `${court.display_name} is not available for the full match at that time.`);
  }
  const breakItem = context.breaks.find(item => item.day_on === dayValue && start < minutesOf(item.ends_at) && end > minutesOf(item.starts_at));
  if (breakItem) throw new ApiError(400, `This match overlaps ${breakItem.label.toLowerCase()}.`);

  const warnings: string[] = [];
  const divisionRules = ruleFor(context, current.division_id);
  if (divisionRules.length && divisionRules[0].allocation_type === 'required' && !divisionRules.some(rule => rule.court_id === court.id)) {
    throw new ApiError(400, 'This division can only play on its required courts.');
  }
  if (divisionRules.length && divisionRules[0].allocation_type === 'preferred' && divisionRules[0].court_id !== court.id) {
    const preferredPosition = divisionRules.findIndex(rule => rule.court_id === court.id);
    warnings.push(preferredPosition < 0
      ? `${court.display_name} is outside this division’s preferred court list.`
      : `${court.display_name} is preference ${preferredPosition + 1}; preference 1 is prioritised.`);
  }

  const candidateStart = absoluteMinute(dayValue, start); const duration = playingDuration(context.settings);
  const candidate: Interval = { match_id: matchId, start: candidateStart, end: candidateStart + duration, teamIds: teamsFor(current), courtId: court.id };
  const otherIntervals = currentIntervals(context, matchId);
  const gap = context.settings.gap_between_games_minutes;
  if (otherIntervals.some(other => other.courtId === court.id && courtConflict(candidate.start, duration, other, gap))) {
    throw new ApiError(409, `Another match is already assigned to ${court.display_name} at that time.`);
  }
  const sameTeamGames = otherIntervals.filter(other => other.teamIds.some(teamId => candidate.teamIds.includes(teamId)));
  if (sameTeamGames.some(other => candidate.start < other.end && other.start < candidate.end)) {
    throw new ApiError(409, 'A team cannot play two matches at the same time.');
  }
  const turnaround = context.settings.team_turnaround_minutes;
  for (const other of sameTeamGames) {
    if (!teamTurnaroundConflict(candidate.start, duration, other, turnaround)) continue;
    const rest = Math.max(0, candidate.start >= other.start ? candidate.start - other.end : other.start - candidate.end);
    warnings.push(`A team would have ${rest} minutes between matches; the configured minimum is ${turnaround} minutes.`);
  }
  const uniqueWarnings = [...new Set(warnings)];
  if (uniqueWarnings.length && !confirmWarnings) return { issue: null, warning: uniqueWarnings.join(' '), court: court.display_name, warnings: uniqueWarnings };
  return { issue: null, warning: uniqueWarnings.length ? uniqueWarnings.join(' ') : null, court: court.display_name, warnings: uniqueWarnings };
}
