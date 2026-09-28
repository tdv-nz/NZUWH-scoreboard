import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, type Bootstrap, type Viewer } from './lib/api';
import { createGroupDraw } from './lib/draw';
import TournamentSetup, { type CourtAllocation, type Organisation, type TournamentDraft } from './TournamentSetup';
import './App.css';

type Tournament = { id: string; name: string; category: string; starts_on: string; ends_on: string; venue: string | null; court_count: number; status: string; record_goal_scorers: number };
type Division = { id: string; tournament_id: string; name: string; group_count: number; round_robins: number; finals_format: string; win_points: number; draw_points: number; loss_points: number };
type Team = { id: string; name: string; organisation: string | null; organisation_id: string | null; colour: string | null };
type Entry = { id: string; division_id: string; team_id: string; group_name: string | null; seed: number | null; team_colour: string | null };
type Court = { id: string; tournament_id: string; display_name: string; display_order: number; active: number };
type TournamentDay = { id: string; tournament_id: string; day_on: string; available: number; starts_at: string; ends_at: string };
type DivisionCourtRule = { id: string; division_id: string; court_id: string; allocation_type: CourtAllocation; preference_order: number };
type Player = { id: string; name: string };
type Roster = { id: string; division_team_id: string; player_id: string };
type Attendance = { match_id: string; player_id: string };
type Goal = { id: string; match_id: string; player_id: string | null; division_team_id: string };
type Match = { id: string; division_id: string; stage: string; round_number: number | null; match_number: number | null; scheduled_on: string | null; starts_at: string | null; court_id: string | null; court: string | null; referee: string | null; home_division_team_id: string | null; away_division_team_id: string | null; home_placeholder: string | null; away_placeholder: string | null; home_score: number | null; away_score: number | null; status: string; schedule_issue: string | null; schedule_warning: string | null };

function MatchScheduleEditor({ match, courts, busy, onSave }: { match: Match; courts: Court[]; busy: boolean; onSave: (change: Partial<Match>) => Promise<void> }) {
  const [draft, setDraft] = useState({ scheduled_on: match.scheduled_on || '', starts_at: match.starts_at?.slice(0, 5) || '', court_id: match.court_id || '' });
  useEffect(() => setDraft({ scheduled_on: match.scheduled_on || '', starts_at: match.starts_at?.slice(0, 5) || '', court_id: match.court_id || '' }), [match.scheduled_on, match.starts_at, match.court_id]);
  const locked = match.status !== 'scheduled';
  return <div className="schedule-editor">
    <input aria-label="Match date" type="date" value={draft.scheduled_on} disabled={busy || locked} onChange={event => setDraft({ ...draft, scheduled_on: event.target.value })}/>
    <input aria-label="Match start time" type="time" value={draft.starts_at} disabled={busy || locked} onChange={event => setDraft({ ...draft, starts_at: event.target.value })}/>
    <select aria-label="Court" value={draft.court_id} disabled={busy || locked} onChange={event => setDraft({ ...draft, court_id: event.target.value })}><option value="">Choose court</option>{courts.map(court => <option key={court.id} value={court.id}>{court.display_name}</option>)}</select>
    <button type="button" disabled={busy || locked} onClick={() => onSave({ scheduled_on: draft.scheduled_on || null, starts_at: draft.starts_at || null, court_id: draft.court_id || null, court: null })}>Save slot</button>
    {match.schedule_issue && <span className="schedule-issue">{match.schedule_issue}</span>}
    {match.schedule_warning && <span className="schedule-warning">{match.schedule_warning}</span>}
  </div>;
}

function CourtRulesEditor({ divisionId, courts, rules, editable, onSave }: {
  divisionId: string; courts: Court[]; rules: DivisionCourtRule[]; editable: boolean;
  onSave: (value: { allocation_type: CourtAllocation; court_ids: string[] }) => Promise<void>;
}) {
  const [draft, setDraft] = useState<{ allocation_type: CourtAllocation; court_ids: string[] }>({ allocation_type: 'any', court_ids: [] });
  const [saving, setSaving] = useState(false);
  const divisionRules = useMemo(() => rules.filter(rule => rule.division_id === divisionId).sort((a, b) => a.preference_order - b.preference_order), [divisionId, rules]);
  useEffect(() => setDraft({ allocation_type: divisionRules[0]?.allocation_type || 'any', court_ids: divisionRules.map(rule => rule.court_id) }), [divisionId, divisionRules]);
  const activeCourts = courts.filter(court => court.active);
  async function save() {
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  }
  function moveCourt(index: number, delta: number) {
    const next = [...draft.court_ids]; const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft({ ...draft, court_ids: next });
  }
  return <section className="court-rules-editor">
    <div className="sectiontitle"><div><h4>Court allocation</h4><p className="hint">Court rules can be changed while this tournament is Draft.</p></div>
      {editable && <button type="button" disabled={saving || (draft.allocation_type !== 'any' && !draft.court_ids.length)} onClick={save}>{saving ? 'Saving…' : 'Save court rule'}</button>}
    </div>
    {editable ? <>
      <label className="court-mode">Allocation<select value={draft.allocation_type} onChange={event => setDraft({ ...draft, allocation_type: event.target.value as CourtAllocation, court_ids: event.target.value === 'any' ? [] : draft.court_ids })}>
        <option value="any">Any active court</option><option value="required">Required court(s)</option><option value="preferred">Preferred court(s)</option>
      </select></label>
      {draft.allocation_type !== 'any' && <div className="court-rule-list">{activeCourts.map(court => {
        const selected = draft.court_ids.includes(court.id); const rank = draft.court_ids.indexOf(court.id);
        return <div className="court-rule-row" key={court.id}><label><input type="checkbox" checked={selected} onChange={event => setDraft({ ...draft, court_ids: event.target.checked ? [...draft.court_ids, court.id] : draft.court_ids.filter(id => id !== court.id) })}/>{court.display_name}</label>
          {selected && draft.allocation_type === 'preferred' && <span>Preference {rank + 1}<button type="button" aria-label={`Move ${court.display_name} preference up`} disabled={rank === 0} onClick={() => moveCourt(rank, -1)}>↑</button><button type="button" aria-label={`Move ${court.display_name} preference down`} disabled={rank === draft.court_ids.length - 1} onClick={() => moveCourt(rank, 1)}>↓</button></span>}
        </div>;
      })}</div>}
    </> : <p className="hint">{divisionRules.length ? `${divisionRules[0].allocation_type === 'required' ? 'Required' : 'Preferred'}: ${divisionRules.sort((a, b) => a.preference_order - b.preference_order).map(rule => courts.find(court => court.id === rule.court_id)?.display_name || 'Unknown court').join(', ')}` : 'Any active court'}</p>}
  </section>;
}

function standings(entries: Entry[], matches: Match[], division: Division) {
  return entries.map(entry => {
    const played = matches.filter(match => match.stage === 'group' && match.status === 'completed' && (match.home_division_team_id === entry.id || match.away_division_team_id === entry.id));
    let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
    for (const match of played) {
      const home = match.home_division_team_id === entry.id;
      const scored = home ? match.home_score! : match.away_score!;
      const conceded = home ? match.away_score! : match.home_score!;
      goalsFor += scored; goalsAgainst += conceded;
      if (scored > conceded) wins++; else if (scored === conceded) draws++; else losses++;
    }
    return { entry, played: played.length, wins, draws, losses, goalsFor, goalsAgainst, points: wins * division.win_points + draws * division.draw_points + losses * division.loss_points };
  }).sort((a, b) => (a.entry.group_name || 'A').localeCompare(b.entry.group_name || 'A') || b.points - a.points || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor);
}

export default function App() {
  const [session, setSession] = useState<Viewer | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [newOrganiser, setNewOrganiser] = useState({ email: '', password: '', role: 'scorer' });
  const [passwordChange, setPasswordChange] = useState({ currentPassword: '', newPassword: '' });
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [tournaments, setTournaments] = useState<Tournament[]>([]); const [divisions, setDivisions] = useState<Division[]>([]);
  const [teams, setTeams] = useState<Team[]>([]); const [entries, setEntries] = useState<Entry[]>([]); const [matches, setMatches] = useState<Match[]>([]);
  const [courts, setCourts] = useState<Court[]>([]); const [tournamentDays, setTournamentDays] = useState<TournamentDay[]>([]); const [divisionCourtRules, setDivisionCourtRules] = useState<DivisionCourtRule[]>([]);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [players, setPlayers] = useState<Player[]>([]); const [rosters, setRosters] = useState<Roster[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]); const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedTournament, setSelectedTournament] = useState(''); const [selectedDivision, setSelectedDivision] = useState('');
  const [tab, setTab] = useState<'overview' | 'teams' | 'players' | 'draw' | 'standings' | 'schedule'>('overview');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [showSetup, setShowSetup] = useState(false);
  const [newTeam, setNewTeam] = useState({ name: '', organisation: '', colour: '#0891b2', group_name: 'A' });
  const [newPlayer, setNewPlayer] = useState({ name: '', entry: '' });
  const [manualStage, setManualStage] = useState('quarter_final');
  const canScore = !!session;
  const tournament = tournaments.find(item => item.id === selectedTournament);
  const division = divisions.find(item => item.id === selectedDivision);
  const divisionEntries = entries.filter(item => item.division_id === selectedDivision);
  const divisionMatches = matches.filter(item => item.division_id === selectedDivision).sort((a, b) => (a.scheduled_on || '').localeCompare(b.scheduled_on || '') || (a.starts_at || '').localeCompare(b.starts_at || '') || (a.match_number || 0) - (b.match_number || 0));
  const tournamentMatches = matches.filter(item => divisions.some(d => d.id === item.division_id && d.tournament_id === selectedTournament))
    .sort((a, b) => (a.scheduled_on || '').localeCompare(b.scheduled_on || '') || (a.starts_at || '').localeCompare(b.starts_at || '') || (courts.find(court => court.id === a.court_id)?.display_name || a.court || '').localeCompare(courts.find(court => court.id === b.court_id)?.display_name || b.court || '') || (a.match_number || 0) - (b.match_number || 0));
  const scheduleHasResults = tournamentMatches.some(match => match.status !== 'scheduled' || match.home_score !== null || match.away_score !== null);
  const scheduledCount = tournamentMatches.filter(match => match.scheduled_on && match.starts_at && match.court_id).length;
  const unscheduledCount = tournamentMatches.filter(match => !match.scheduled_on || !match.starts_at || !match.court_id).length;
  const pendingScheduleCount = tournamentMatches.filter(match => match.status === 'scheduled' && match.home_score === null && match.away_score === null && (!match.scheduled_on || !match.starts_at || !match.court_id)).length;
  const rows = useMemo(() => division ? standings(divisionEntries, divisionMatches, division) : [], [division, divisionEntries, divisionMatches]);
  const teamName = (id: string | null) => teams.find(team => team.id === entries.find(entry => entry.id === id)?.team_id)?.name || 'TBC';
  const teamColour = (id: string | null) => entries.find(entry => entry.id === id)?.team_colour || teams.find(team => team.id === entries.find(entry => entry.id === id)?.team_id)?.colour || '#94a3b8';
  const courtName = (id: string | null, legacyName: string | null = null) => courts.find(court => court.id === id)?.display_name || legacyName || '—';
  const organisationName = (team: Team | undefined) => organisations.find(item => item.id === team?.organisation_id)?.name || team?.organisation || '—';
  const organisationKind = tournament?.category === 'regional' ? 'region' : tournament?.category || 'club';
  const organisationLabel = organisationKind[0].toUpperCase() + organisationKind.slice(1);
  function exportSchedule() {
    const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = [['Date', 'Time', 'Court', 'Game', 'Division', 'Stage', 'White', 'Score', 'Black', 'Score', 'Referee', 'Schedule notes'],
      ...tournamentMatches.map(match => [match.scheduled_on, match.starts_at?.slice(0, 5), courtName(match.court_id, match.court), match.match_number,
        divisions.find(d => d.id === match.division_id)?.name, match.stage.replace('_', ' '),
        teamName(match.home_division_team_id) === 'TBC' ? match.home_placeholder : teamName(match.home_division_team_id), match.home_score,
        teamName(match.away_division_team_id) === 'TBC' ? match.away_placeholder : teamName(match.away_division_team_id), match.away_score, match.referee, match.schedule_issue || match.schedule_warning])];
    const file = new Blob([rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(file); link.download = `${tournament?.name || 'championship'}-schedule.csv`;
    link.click(); URL.revokeObjectURL(link.href);
  }
  const fail = (error: any) => setMessage(error?.message || String(error));
  const load = useCallback(async () => {
    try {
      const data = await api<Bootstrap>('bootstrap');
      setSession(data.viewer); setIsAdmin(data.viewer?.role === 'admin');
      setTournaments(data.tournaments); setDivisions(data.divisions); setTeams(data.teams); setEntries(data.entries);
      setMatches(data.matches); setOrganisations(data.organisations); setPlayers(data.players);
      setCourts(data.courts); setTournamentDays(data.tournament_days); setDivisionCourtRules(data.division_court_rules);
      setRosters(data.rosters); setAttendance(data.attendance); setGoals(data.goals);
      setSelectedTournament(current => current && data.tournaments.some(item => item.id === current) ? current : data.tournaments[0]?.id || '');
    } catch (error) { fail(error); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelectedDivision(current => divisions.some(item => item.id === current && item.tournament_id === selectedTournament) ? current : divisions.find(item => item.tournament_id === selectedTournament)?.id || ''); }, [selectedTournament, divisions]);
  useEffect(() => { setNewTeam(current => ({ ...current, organisation: '' })); }, [selectedTournament]);
  async function save(action: () => Promise<any>) { setBusy(true); setMessage(''); try { await action(); await load(); setMessage('Saved'); } catch (error) { fail(error); } finally { setBusy(false); } }
  async function signIn(event: React.FormEvent) { event.preventDefault(); setMessage(''); setBusy(true); try { await api('login', 'POST', { email, password }); setPassword(''); await load(); } catch (error) { fail(error); } finally { setBusy(false); } }
  async function signOut() { try { await api('logout', 'POST'); await load(); } catch (error) { fail(error); } }
  async function createTournament(draft: TournamentDraft): Promise<boolean> {
    setBusy(true); setMessage('');
    try {
      const payload = { ...draft, divisions: draft.divisions.map(division => ({
        ...division,
        court_rule: { allocation_type: division.court_rule.allocation_type,
          court_names: division.court_rule.court_ids.map(courtId => draft.courts.find(court => court.id === courtId)?.display_name).filter(Boolean) },
        teams: division.teams.map(team => ({ name: team.name, organisation: team.organisation, colour: team.colour, group_name: team.group_name })),
      })),
        courts: draft.courts.map(court => ({ display_name: court.display_name, active: court.active })),
        days: draft.days.map(day => ({ ...day, court_availability: day.available ? day.court_availability.map(item => ({
          court_name: draft.courts.find(court => court.id === item.court_id)?.display_name,
          windows: item.windows,
        })) : [] })),
      };
      const data = await api<{ id: string }>('tournaments', 'POST', payload);
      await load(); setSelectedTournament(data.id); setShowSetup(false); setMessage('Tournament, divisions and teams created.');
      return true;
    } catch (error) { fail(error); return false; } finally { setBusy(false); }
  }
  async function addTeam(event: React.FormEvent) { event.preventDefault(); if (!division || !newTeam.organisation.trim()) { setMessage(`Choose a ${organisationKind} for the team.`); return; } await save(async () => {
    await api('teams', 'POST', { division_id: division.id, ...newTeam });
    setNewTeam({ ...newTeam, name: '', organisation: '' });
  }); }
  async function addPlayer(event: React.FormEvent) { event.preventDefault(); if (!newPlayer.entry) { setMessage('Choose a team for the player.'); return; } await save(async () => {
    await api('players', 'POST', { name: newPlayer.name.trim(), division_team_id: newPlayer.entry });
    setNewPlayer({ ...newPlayer, name: '' });
  }); }
  async function setAttended(matchId: string, playerId: string, present: boolean) {
    if (!present && goals.some(goal => goal.match_id === matchId && goal.player_id === playerId)) { setMessage('Remove recorded goals before marking this player absent.'); return; }
    await save(() => api('attendance', present ? 'POST' : 'DELETE', { match_id: matchId, player_id: playerId }));
  }
  async function addGoal(matchId: string, playerId: string, entryId: string) {
    if (!attendance.some(row => row.match_id === matchId && row.player_id === playerId)) { setMessage('Mark the player as attended first.'); return; }
    await save(() => api('goals', 'POST', { match_id: matchId, player_id: playerId, division_team_id: entryId }));
  }
  async function removeGoal(matchId: string, playerId: string) {
    const goal = goals.find(row => row.match_id === matchId && row.player_id === playerId);
    if (goal) await save(() => api(`goals/${goal.id}`, 'DELETE'));
  }
  async function generateDraw() { if (!division || !tournament) return; if (divisionMatches.some(match => match.stage === 'group')) { setMessage('Group fixtures already exist. Edit them below.'); return; } if (divisionEntries.length < 2) { setMessage('Add at least two teams first.'); return; }
    const offset = Math.max(0, ...tournamentMatches.map(match => match.match_number || 0));
    const firstPlayingDay = tournamentDays.filter(day => day.tournament_id === tournament.id && day.available).sort((a, b) => a.day_on.localeCompare(b.day_on))[0]?.day_on || tournament.starts_on;
    const fixtures = createGroupDraw(division.id, divisionEntries, division.round_robins as 1 | 2, firstPlayingDay).map((fixture, index) => ({ ...fixture, match_number: offset + index + 1, court_id: null }));
    await save(() => api('matches', 'POST', { matches: fixtures })); setTab('draw'); }
  async function addFinal() { if (!division) return; await save(() => api('matches', 'POST', { matches: [{ division_id: division.id, stage: manualStage, scheduled_on: tournament?.ends_on, match_number: Math.max(0, ...tournamentMatches.map(match => match.match_number || 0)) + 1, home_placeholder: 'Seed / winner TBC', away_placeholder: 'Seed / winner TBC' }] })); }
  async function generateFinals() {
    if (!division || !tournament) return;
    if (division.finals_format === 'none') { setMessage('This division uses pool standings for final rankings.'); return; }
    if (division.finals_format === 'manual') { setMessage('This division uses custom finals. Add the fixtures below.'); return; }
    if (divisionMatches.some(match => match.stage !== 'group')) { setMessage('Knockout fixtures already exist. Add any extra placing games individually.'); return; }
    const poolGames = divisionMatches.filter(match => match.stage === 'group');
    if (!poolGames.length || poolGames.some(match => match.status !== 'completed')) { setMessage('Complete every pool match before seeding the finals.'); return; }
    const pools = [...new Set(divisionEntries.map(entry => entry.group_name || 'A'))].sort();
    const ranked = (pool: string) => rows.filter(row => (row.entry.group_name || 'A') === pool).map(row => row.entry.id);
    let nextMatchNumber = Math.max(0, ...tournamentMatches.map(match => match.match_number || 0)) + 1;
    const pending: Record<string, unknown>[] = [];
    const make = async (stage: string, home: string | null, away: string | null, homeLabel: string, awayLabel: string, homeSource?: string, awaySource?: string, homeOutcome?: string, awayOutcome?: string) => {
      const matchId = crypto.randomUUID();
      pending.push({ id: matchId, division_id: division.id, stage, match_number: nextMatchNumber++, scheduled_on: tournament.ends_on,
        home_division_team_id: home, away_division_team_id: away, home_placeholder: homeLabel, away_placeholder: awayLabel,
        home_source_match_id: homeSource || null, away_source_match_id: awaySource || null,
        home_source_outcome: homeOutcome || null, away_source_outcome: awayOutcome || null });
      return matchId;
    };
    setBusy(true); setMessage('');
    try {
      let semi1: string, semi2: string;
      if (division.finals_format === 'two_pool_crossover' && pools.length === 2 && ranked(pools[0]).length >= 3 && ranked(pools[1]).length >= 3) {
        const a = ranked(pools[0]), b = ranked(pools[1]);
        const q1 = await make('quarter_final', a[1], b[2], `${pools[0]} seed 2`, `${pools[1]} seed 3`);
        const q2 = await make('quarter_final', b[1], a[2], `${pools[1]} seed 2`, `${pools[0]} seed 3`);
        await make('placement', null, null, 'Loser quarter-final 1', 'Loser quarter-final 2', q1, q2, 'loser', 'loser');
        semi1 = await make('semi_final', a[0], null, `${pools[0]} seed 1`, 'Winner quarter-final 2', undefined, q2, undefined, 'winner');
        semi2 = await make('semi_final', b[0], null, `${pools[1]} seed 1`, 'Winner quarter-final 1', undefined, q1, undefined, 'winner');
      } else if (division.finals_format === 'top_two' && ranked('A').length >= 2) {
        const a = ranked('A');
        await make('final', a[0], a[1], 'Seed 1', 'Seed 2');
        await api('matches', 'POST', { matches: pending }); await load(); setMessage('Top-two final created. Add its time and court.'); return;
      } else if (division.finals_format === 'top_four' && ranked('A').length >= 4) {
        const a = ranked('A');
        semi1 = await make('semi_final', a[0], a[3], 'Seed 1', 'Seed 4');
        semi2 = await make('semi_final', a[1], a[2], 'Seed 2', 'Seed 3');
        if (a.length >= 6) await make('placement', a[4], a[5], 'Seed 5', 'Seed 6');
      } else { setMessage('This division does not have enough completed pool rankings for its selected finals format.'); return; }
      await make('placement', null, null, 'Loser semi-final 1', 'Loser semi-final 2', semi1, semi2, 'loser', 'loser');
      await make('final', null, null, 'Winner semi-final 1', 'Winner semi-final 2', semi1, semi2, 'winner', 'winner');
      await api('matches', 'POST', { matches: pending }); await load(); setMessage('Seeded finals created. Add times and courts, then any extra placing games.');
    } catch (error) { fail(error); } finally { setBusy(false); }
  }
  async function updateMatch(match: Match, change: Partial<Match>) {
    await save(async () => {
      try { await api(`matches/${match.id}`, 'PATCH', change); }
      catch (error) {
        if (!(error instanceof ApiError) || !error.data?.requires_confirmation || !Array.isArray(error.data.warnings)) throw error;
        const explanation = error.data.warnings.join('\n');
        if (!window.confirm(`${explanation}\n\nSave this schedule change anyway?`)) throw new Error('Schedule change cancelled.');
        await api(`matches/${match.id}`, 'PATCH', { ...change, confirm_warnings: true });
      }
    });
  }
  async function generateSchedule() {
    if (!tournament) return;
    setBusy(true); setMessage('');
    try {
      const result = await api<{ summary: string }>(`tournaments/${tournament.id}/schedule/generate`, 'POST', {});
      await load(); setTab('schedule'); setMessage(result.summary);
    } catch (error) { fail(error); } finally { setBusy(false); }
  }
  async function updateDivision(change: Partial<Division>) { if (!division) return; await save(() => api(`divisions/${division.id}`, 'PATCH', change)); }
  function matchStats(match: Match) {
    if (!canScore || (!match.home_division_team_id && !match.away_division_team_id)) return null;
    return <details className="matchstats"><summary>Attendance and scorers</summary><div className="rostergrid">
      {[match.home_division_team_id, match.away_division_team_id].filter(Boolean).map(entryId =>
        <div key={entryId}><h4>{teamName(entryId)}</h4>{rosters.filter(roster => roster.division_team_id === entryId).map(roster => {
          const attended = attendance.some(row => row.match_id === match.id && row.player_id === roster.player_id);
          const goalCount = goals.filter(goal => goal.match_id === match.id && goal.player_id === roster.player_id).length;
          return <div className="rosterrow" key={roster.id}><label><input type="checkbox" checked={attended} onChange={event => setAttended(match.id, roster.player_id, event.target.checked)}/>{players.find(player => player.id === roster.player_id)?.name}</label>
            <span><button type="button" disabled={!attended} onClick={() => addGoal(match.id, roster.player_id, entryId)}>+ goal</button><b>{goalCount}</b>{goalCount > 0 && <button type="button" onClick={() => removeGoal(match.id, roster.player_id)}>−</button>}</span></div>;
        })}</div>)}</div></details>;
  }
  return <div className="app">
    <header className="masthead"><div><span className="eyebrow">Underwater Hockey New Zealand</span><h1>Championships</h1></div><div className="account">{session ? <><span>{session.email}{isAdmin ? ' · Admin' : ' · Scorer'}</span><button onClick={signOut}>Sign out</button></> : <span>Public view</span>}</div></header>
    {message && <div className="notice" role="status">{message}<button onClick={() => setMessage('')}>×</button></div>}
    {!session && <form className="signin" onSubmit={signIn}><strong>Organiser sign in</strong><input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required/><input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required/><button>Sign in</button></form>}
    {session && <details className="panel account-settings"><summary>Account settings</summary>
      <form className="inlineform" onSubmit={event => { event.preventDefault(); (async () => { setBusy(true); try { await api('password', 'POST', passwordChange); setPasswordChange({ currentPassword: '', newPassword: '' }); await load(); setMessage('Password changed. Sign in again.'); } catch (error) { fail(error); } finally { setBusy(false); } })(); }}>
        <input type="password" autoComplete="current-password" required placeholder="Current password" value={passwordChange.currentPassword} onChange={event => setPasswordChange({ ...passwordChange, currentPassword: event.target.value })}/>
        <input type="password" autoComplete="new-password" minLength={12} required placeholder="New password (12+ characters)" value={passwordChange.newPassword} onChange={event => setPasswordChange({ ...passwordChange, newPassword: event.target.value })}/>
        <button disabled={busy}>Change password</button>
      </form>
      {isAdmin && <form className="inlineform" onSubmit={event => { event.preventDefault(); save(async () => { await api('users', 'POST', newOrganiser); setNewOrganiser({ email: '', password: '', role: 'scorer' }); }); }}>
        <input type="email" required placeholder="New organiser email" value={newOrganiser.email} onChange={event => setNewOrganiser({ ...newOrganiser, email: event.target.value })}/>
        <input type="password" autoComplete="new-password" minLength={12} required placeholder="Temporary password (12+ characters)" value={newOrganiser.password} onChange={event => setNewOrganiser({ ...newOrganiser, password: event.target.value })}/>
        <select value={newOrganiser.role} onChange={event => setNewOrganiser({ ...newOrganiser, role: event.target.value })}><option value="scorer">Scorer</option><option value="admin">Admin</option></select>
        <button disabled={busy}>Add organiser</button>
      </form>}
    </details>}
    <main>
      <div className="topline"><div><span className="eyebrow">Events</span><h2>Tournaments</h2></div><div className="tournament-actions">{isAdmin && !!tournaments.length && <button onClick={() => setShowSetup(value => !value)}>{showSetup ? 'Close setup' : 'New tournament'}</button>}<select aria-label="Select tournament" value={selectedTournament} onChange={e => setSelectedTournament(e.target.value)}><option value="">Select tournament</option>{tournaments.map(item => <option key={item.id} value={item.id}>{item.name} · {item.starts_on}</option>)}</select></div></div>
      {isAdmin && (showSetup || !tournaments.length) && <TournamentSetup busy={busy} organisations={organisations} teams={teams} onCreate={createTournament}/>}
      {tournament ? <><section className="eventhead"><div><span className="tag">{tournament.category} · {tournament.status}</span><h2>{tournament.name}</h2><p>{tournament.starts_on} to {tournament.ends_on}{tournament.venue ? ` · ${tournament.venue}` : ''} · {tournament.court_count} {tournament.court_count === 1 ? 'court' : 'courts'}</p><p className="scoring-mode">Scoring mode: <strong>{tournament.record_goal_scorers ? 'Team scores and goal scorers' : 'Team scores only'}</strong></p></div>{isAdmin && <label>Status<select value={tournament.status} onChange={e => save(() => api(`tournaments/${tournament.id}`, 'PATCH', { status: e.target.value }))}><option value="draft">Draft</option><option value="published">Published</option><option value="completed">Completed</option></select></label>}</section>
        <div className="divisionbar">{divisions.filter(item => item.tournament_id === tournament.id).map(item => <button className={selectedDivision === item.id ? 'active' : ''} key={item.id} onClick={() => setSelectedDivision(item.id)}>{item.name}</button>)}{isAdmin && <button onClick={() => { const name = prompt('New division name'); if (name?.trim()) save(() => api('divisions', 'POST', { tournament_id: tournament.id, name: name.trim() })); }}>+ Division</button>}</div>
        {division && <><nav className="tabs">{(['overview','teams',...(session ? ['players' as const] : []),'draw','standings','schedule'] as const).map(item => <button className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)}>{item}</button>)}</nav>
          {tab === 'overview' && <section className="panel"><h3>{division.name} format</h3><div className="metrics"><div><b>{divisionEntries.length}</b><span>Teams</span></div><div><b>{divisionMatches.filter(m => m.stage === 'group').length}</b><span>Pool games</span></div><div><b>{divisionMatches.filter(m => m.stage !== 'group').length}</b><span>Finals and placing</span></div></div>{isAdmin && <div className="formgrid"><label>Groups<select value={division.group_count} disabled={divisionEntries.length > 0 || divisionMatches.some(match => match.stage === 'group')} onChange={e => updateDivision({ group_count: Number(e.target.value) })}><option value={1}>One group</option><option value={2}>Two groups</option></select></label><label>Round robin<select value={division.round_robins} disabled={divisionMatches.some(match => match.stage === 'group')} onChange={e => updateDivision({ round_robins: Number(e.target.value) })}><option value={1}>Single</option><option value={2}>Double</option></select></label><label>Finals format<select value={division.finals_format} disabled={divisionMatches.some(match => match.stage !== 'group')} onChange={e => updateDivision({ finals_format: e.target.value })}><option value="none">No finals</option>{division.group_count === 1 ? <><option value="top_two">Top two final</option><option value="top_four">Top four semi-finals</option></> : <option value="two_pool_crossover">Crossover quarter-finals</option>}<option value="manual">Custom finals</option></select></label></div>}<CourtRulesEditor divisionId={division.id} courts={courts.filter(court => court.tournament_id === tournament.id)} rules={divisionCourtRules} editable={isAdmin && tournament.status === 'draft'} onSave={change => save(() => api(`divisions/${division.id}/court-rules`, 'PUT', change))}/><p className="hint">Set teams and pools, then generate fixtures. The schedule builder will use the saved court rules and playing windows.</p></section>}
          {tab === 'teams' && <section className="panel"><h3>Teams and pools</h3>{isAdmin && !divisionMatches.some(match => match.stage === 'group') && <form className="inlineform" onSubmit={addTeam}><input placeholder="Team name" value={newTeam.name} onChange={e => setNewTeam({ ...newTeam, name: e.target.value })} required/><input list="existing-organisations" required placeholder={organisationLabel} aria-label={organisationLabel} value={newTeam.organisation} onChange={e => setNewTeam({ ...newTeam, organisation: e.target.value })}/><datalist id="existing-organisations">{organisations.filter(item => item.kind === organisationKind).map(item => <option key={item.id} value={item.name}/>)}{organisationKind === 'region' && ['Northern', 'Central', 'Southern'].map(name => <option value={name} key={name}/>)}</datalist><input type="color" title="Team colour" value={newTeam.colour} onChange={e => setNewTeam({ ...newTeam, colour: e.target.value })}/>{division.group_count === 2 && <select value={newTeam.group_name} onChange={e => setNewTeam({ ...newTeam, group_name: e.target.value })}><option value="A">Pool A</option><option value="B">Pool B</option></select>}<button disabled={busy}>Add team</button></form>}<div className="tablewrap"><table><thead><tr><th>Team</th><th>{organisationLabel}</th><th>Pool</th><th>Seed</th></tr></thead><tbody>{divisionEntries.map(entry => { const team = teams.find(item => item.id === entry.team_id); return <tr key={entry.id}><td><i className="swatch" style={{ background: entry.team_colour || team?.colour || '#94a3b8' }}/>{team?.name}</td><td>{organisationName(team)}</td><td>{isAdmin && division.group_count === 2 ? <select value={entry.group_name || 'A'} disabled={divisionMatches.some(match => match.stage === 'group')} onChange={e => save(() => api(`division_teams/${entry.id}`, 'PATCH', { group_name: e.target.value, seed: null }))}><option>A</option><option>B</option></select> : entry.group_name || 'A'}</td><td>{entry.seed || '—'}</td></tr>; })}</tbody></table></div></section>}
          {tab === 'players' && session && <section className="panel"><h3>Team rosters</h3>{isAdmin && <form className="inlineform" onSubmit={addPlayer}><input placeholder="Player name" value={newPlayer.name} onChange={e => setNewPlayer({ ...newPlayer, name: e.target.value })} required/><select value={newPlayer.entry} onChange={e => setNewPlayer({ ...newPlayer, entry: e.target.value })} required><option value="">Choose team</option>{divisionEntries.map(entry => <option key={entry.id} value={entry.id}>{teamName(entry.id)}</option>)}</select><button disabled={busy}>Add player</button></form>}<div className="tablewrap"><table><thead><tr><th>Team</th><th>Player</th></tr></thead><tbody>{rosters.filter(roster => divisionEntries.some(entry => entry.id === roster.division_team_id)).sort((a,b) => teamName(a.division_team_id).localeCompare(teamName(b.division_team_id))).map(roster => <tr key={roster.id}><td>{teamName(roster.division_team_id)}</td><td>{players.find(player => player.id === roster.player_id)?.name}</td></tr>)}</tbody></table></div></section>}
          {tab === 'draw' && <section className="panel">
            <div className="sectiontitle"><div><h3>Draw and results</h3><p>Dates and court times can be adjusted for the tournament programme.</p></div>{isAdmin && !divisionMatches.some(m => m.stage === 'group') && <button onClick={generateDraw} disabled={busy}>Generate pool draw</button>}</div>
            {isAdmin && <div className="inlineform secondary">{division.finals_format !== 'none' && division.finals_format !== 'manual' && <button onClick={generateFinals} disabled={busy || !divisionMatches.some(m => m.stage === 'group')}>Generate seeded finals</button>}<select value={manualStage} onChange={e => setManualStage(e.target.value)}><option value="quarter_final">Quarter-final</option><option value="semi_final">Semi-final</option><option value="placement">Placing match</option><option value="final">Final</option></select><button onClick={addFinal}>+ Add knockout / placing game</button></div>}
            <div className="fixtures">{divisionMatches.map(match => <article className="fixture" key={match.id}>
              <div className="fixturemeta"><span className="tag">{match.stage.replace('_', ' ')}</span><span>#{match.match_number || '—'}</span>{isAdmin ? <>
                <MatchScheduleEditor match={match} courts={courts.filter(court => court.tournament_id === tournament.id && court.active)} busy={busy} onSave={change => updateMatch(match, change)}/>
                <input placeholder="Referee" defaultValue={match.referee || ''} onBlur={e => { if (e.target.value !== (match.referee || '')) updateMatch(match, { referee: e.target.value }); }}/>
              </> : <span>{match.scheduled_on} {match.starts_at?.slice(0,5)} {courtName(match.court_id, match.court)} · {match.referee}</span>}</div>
              <div className="fixturebody"><div className="side" style={{ borderColor: teamColour(match.home_division_team_id) }}>{isAdmin ? <select value={match.home_division_team_id || ''} disabled={match.status === 'completed' || attendance.some(row => row.match_id === match.id)} onChange={e => updateMatch(match, { home_division_team_id: e.target.value || null })}><option value="">{match.home_placeholder || 'Select team'}</option>{divisionEntries.map(entry => <option value={entry.id} key={entry.id}>{teamName(entry.id)}</option>)}</select> : teamName(match.home_division_team_id) === 'TBC' ? match.home_placeholder || 'TBC' : teamName(match.home_division_team_id)}</div><span className="versus">v</span><div className="side" style={{ borderColor: teamColour(match.away_division_team_id) }}>{isAdmin ? <select value={match.away_division_team_id || ''} disabled={match.status === 'completed' || attendance.some(row => row.match_id === match.id)} onChange={e => updateMatch(match, { away_division_team_id: e.target.value || null })}><option value="">{match.away_placeholder || 'Select team'}</option>{divisionEntries.map(entry => <option value={entry.id} key={entry.id}>{teamName(entry.id)}</option>)}</select> : teamName(match.away_division_team_id) === 'TBC' ? match.away_placeholder || 'TBC' : teamName(match.away_division_team_id)}</div>{canScore ? <div className="scoreedit"><input type="number" min="0" placeholder="H" defaultValue={match.home_score ?? ''} id={`h-${match.id}`}/><span>:</span><input type="number" min="0" placeholder="A" defaultValue={match.away_score ?? ''} id={`a-${match.id}`}/><button onClick={() => { const h = (document.getElementById(`h-${match.id}`) as HTMLInputElement).value; const a = (document.getElementById(`a-${match.id}`) as HTMLInputElement).value; if (!match.home_division_team_id || !match.away_division_team_id || h === '' || a === '') { setMessage('Select both teams and enter both scores.'); return; } if (match.stage !== 'group' && h === a) { setMessage('Enter the decided knockout result so the winner can advance.'); return; } updateMatch(match, { home_score: Number(h), away_score: Number(a), status: 'completed' }); }}>Save score</button></div> : <strong className="score">{match.status === 'completed' ? `${match.home_score} : ${match.away_score}` : '—'}</strong>}</div>{matchStats(match)}
            </article>)}</div>{!divisionMatches.length && <p className="empty">No fixtures yet.</p>}
          </section>}
          {tab === 'standings' && <section className="panel"><h3>Pool standings</h3><div className="tablewrap"><table><thead><tr><th>Pool</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>{rows.map(row => <tr key={row.entry.id}><td>{row.entry.group_name || 'A'}</td><td><i className="swatch" style={{ background: teamColour(row.entry.id) }}/>{teamName(row.entry.id)}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalsFor - row.goalsAgainst}</td><td><strong>{row.points}</strong></td></tr>)}</tbody></table></div><p className="hint">Teams are sorted by points, goal difference, then goals scored. Organisers can enter seeded knockout fixtures in Draw.</p></section>}
          {tab === 'schedule' && <section className="panel schedule"><div className="sectiontitle"><div><h3>Full tournament schedule</h3><p>All divisions, ordered by day, time and court.</p><p className="schedule-summary">{scheduledCount} scheduled · {unscheduledCount} unscheduled{tournamentMatches.some(match => match.schedule_warning) ? ` · ${tournamentMatches.filter(match => match.schedule_warning).length} fallback or warning` : ''}</p></div><div className="schedule-actions">{isAdmin && <button disabled={busy || (scheduleHasResults ? !pendingScheduleCount : !tournamentMatches.length)} onClick={generateSchedule}>{scheduleHasResults ? 'Schedule unscheduled fixtures' : scheduledCount ? 'Rebuild schedule' : 'Generate schedule'}</button>}<button onClick={() => window.print()}>Print</button><button onClick={exportSchedule}>Export CSV</button></div></div>{isAdmin && scheduleHasResults && <p className="hint">Rebuilding the existing schedule is locked after play starts; newly added unscheduled fixtures can still be placed.</p>}<div className="tablewrap"><table><thead><tr><th>Date</th><th>Time</th><th>Court</th><th>Game</th><th>Division</th><th>Stage</th><th>White</th><th>Score</th><th>Black</th><th>Score</th><th>Referee</th><th>Schedule notes</th></tr></thead><tbody>{tournamentMatches.map(match => <tr key={match.id}><td>{match.scheduled_on || '—'}</td><td>{match.starts_at?.slice(0, 5) || '—'}</td><td>{courtName(match.court_id, match.court)}</td><td>{match.match_number || '—'}</td><td>{divisions.find(d => d.id === match.division_id)?.name}</td><td>{match.stage.replace('_', ' ')}</td><td>{teamName(match.home_division_team_id) === 'TBC' ? match.home_placeholder || 'TBC' : teamName(match.home_division_team_id)}</td><td>{match.home_score ?? ''}</td><td>{teamName(match.away_division_team_id) === 'TBC' ? match.away_placeholder || 'TBC' : teamName(match.away_division_team_id)}</td><td>{match.away_score ?? ''}</td><td>{match.referee || '—'}</td><td>{match.schedule_issue || match.schedule_warning || '—'}</td></tr>)}</tbody></table></div></section>}
        </>}
      </> : <section className="panel empty">No tournaments yet. An admin can create the first championship above.</section>}
    </main>
  </div>;
}
