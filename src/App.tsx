import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, type Bootstrap, type Viewer } from './lib/api';
import { createGroupDraw } from './lib/draw';
import TournamentSetup, { type CourtAllocation, type Organisation, type TournamentDraft } from './TournamentSetup';
import { CalendarDays, ClipboardList, Home, LogIn, LogOut, Settings, Shield, Trophy, Users, Waves } from 'lucide-react';
import './App.css';
import './Scorer.css';

type Tournament = { id: string; name: string; category: string; starts_on: string; ends_on: string; venue: string | null; court_count: number; status: string; record_goal_scorers: number };
type Division = { id: string; tournament_id: string; name: string; group_count: number; round_robins: number; finals_format: string; win_points: number; draw_points: number; loss_points: number };
type Team = { id: string; name: string; organisation: string | null; organisation_id: string | null; colour: string | null };
type Entry = { id: string; division_id: string; team_id: string; group_name: string | null; seed: number | null; team_colour: string | null };
type Court = { id: string; tournament_id: string; display_name: string; display_order: number; active: number };
type TournamentDay = { id: string; tournament_id: string; day_on: string; available: number; starts_at: string; ends_at: string };
type DivisionCourtRule = { id: string; division_id: string; court_id: string; allocation_type: CourtAllocation; preference_order: number };
type Player = { id: string; name: string };
type OrganiserAccount = { id: string; email: string; role: 'admin' | 'scorer'; created_at: string };
type Roster = { id: string; division_team_id: string; player_id: string };
type Attendance = { match_id: string; player_id: string };
type Goal = { id: string; match_id: string; player_id: string | null; division_team_id: string };
type Match = { id: string; division_id: string; stage: string; round_number: number | null; match_number: number | null; scheduled_on: string | null; starts_at: string | null; court_id: string | null; court: string | null; referee: string | null; home_division_team_id: string | null; away_division_team_id: string | null; home_placeholder: string | null; away_placeholder: string | null; home_score: number | null; away_score: number | null; status: string; schedule_issue: string | null; schedule_warning: string | null };

function TournamentDrawSheet({ tournament, matches, divisions, courts, days, entries, teams }: {
  tournament: Tournament; matches: Match[]; divisions: Division[]; courts: Court[]; days: TournamentDay[]; entries: Entry[]; teams: Team[];
}) {
  const activeCourts = courts.filter(court => court.tournament_id === tournament.id && court.active).sort((a, b) => a.display_order - b.display_order);
  const dates = [...new Set([
    ...days.filter(day => day.tournament_id === tournament.id && day.available).map(day => day.day_on),
    ...matches.map(match => match.scheduled_on).filter((day): day is string => !!day),
  ])].sort();
  const unscheduled = matches.filter(match => !match.scheduled_on || !match.starts_at || (!match.court_id && !match.court));
  const divisionName = (id: string) => divisions.find(division => division.id === id)?.name || 'Division';
  const teamForEntry = (id: string | null, placeholder: string | null) => {
    if (!id) return placeholder || 'TBC';
    return teams.find(team => team.id === entries.find(entry => entry.id === id)?.team_id)?.name || placeholder || 'TBC';
  };
  const entryColour = (id: string | null) => id ? entries.find(entry => entry.id === id)?.team_colour || teams.find(team => team.id === entries.find(entry => entry.id === id)?.team_id)?.colour || '#94a3b8' : '#94a3b8';
  const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const groupEntries = divisions.filter(division => division.tournament_id === tournament.id).flatMap(division => {
    const divisionEntries = entries.filter(entry => entry.division_id === division.id);
    const groups = division.group_count === 2 ? ['A', 'B'] : ['A'];
    return groups.map(group => ({
      key: `${division.id}-${group}`,
      label: division.group_count === 2 ? `${division.name} · Pool ${group}` : division.name,
      entries: divisionEntries.filter(entry => (entry.group_name || 'A') === group)
        .sort((a, b) => (a.seed || Number.MAX_SAFE_INTEGER) - (b.seed || Number.MAX_SAFE_INTEGER) || teamForEntry(a.id, '').localeCompare(teamForEntry(b.id, ''))),
    })).filter(group => group.entries.length);
  });

  return <div className="tournament-draw-sheet">
    <header className="draw-sheet-header"><div><span>Underwater Hockey New Zealand · Tournament draw</span><h2>{tournament.name}</h2><p>{tournament.starts_on} – {tournament.ends_on}{tournament.venue ? ` · ${tournament.venue}` : ''}</p></div><span className="draw-version">Generated draw</span></header>
    {dates.map(day => <section className="draw-day" key={day}>
      <h3>{dayLabel(day)}</h3>
      {activeCourts.length ? <div className="draw-court-grid">{activeCourts.map(court => {
        const games = matches.filter(match => match.scheduled_on === day && match.starts_at && (match.court_id === court.id || (!match.court_id && match.court?.toLocaleLowerCase() === court.display_name.toLocaleLowerCase())))
          .sort((a, b) => (a.starts_at || '').localeCompare(b.starts_at || '') || (a.match_number || 0) - (b.match_number || 0));
        return <section className="draw-court" key={court.id}><h4>{court.display_name}</h4><table><colgroup><col className="draw-col-time"/><col className="draw-col-game"/><col className="draw-col-grade"/><col className="draw-col-team"/><col className="draw-col-score"/><col className="draw-col-team"/><col className="draw-col-score"/><col className="draw-col-ref"/><col className="draw-col-comment"/></colgroup><thead><tr><th>Time</th><th>Game</th><th>Grade</th><th>White</th><th>Score</th><th>Black</th><th>Score</th><th>Refs</th><th>Comments</th></tr></thead><tbody>{games.length ? games.map(match => <tr key={match.id} className={`draw-game status-${match.status}`}><td>{match.starts_at?.slice(0, 5)}</td><td>{match.match_number || '—'}</td><td>{divisionName(match.division_id)}</td><td className="draw-team" style={{ borderLeftColor: entryColour(match.home_division_team_id) }}>{teamForEntry(match.home_division_team_id, match.home_placeholder)}</td><td>{match.home_score ?? ''}</td><td className="draw-team" style={{ borderLeftColor: entryColour(match.away_division_team_id) }}>{teamForEntry(match.away_division_team_id, match.away_placeholder)}</td><td>{match.away_score ?? ''}</td><td>{match.referee || ''}</td><td>{match.schedule_issue || match.schedule_warning || ''}</td></tr>) : <tr><td colSpan={9} className="draw-no-games">No games scheduled on this court.</td></tr>}</tbody></table></section>;
      })}</div> : <p className="hint">Add an active court to display the draw.</p>}
    </section>)}
    {!!unscheduled.length && <section className="draw-unscheduled"><h3>Fixtures to schedule</h3><table><thead><tr><th>Game</th><th>Grade</th><th>White</th><th>Black</th><th>Schedule note</th></tr></thead><tbody>{unscheduled.map(match => <tr key={match.id}><td>{match.match_number || '—'}</td><td>{divisionName(match.division_id)}</td><td>{teamForEntry(match.home_division_team_id, match.home_placeholder)}</td><td>{teamForEntry(match.away_division_team_id, match.away_placeholder)}</td><td>{match.schedule_issue || 'Date, time, or court not assigned'}</td></tr>)}</tbody></table></section>}
    {!!groupEntries.length && <section className="draw-team-index"><h3>Teams by pool</h3><div className="draw-team-grid">{groupEntries.map(group => <section className="draw-team-group" key={group.key}><h4>{group.label}</h4><table><tbody>{group.entries.map((entry, index) => {
      const team = teams.find(item => item.id === entries.find(row => row.id === entry.id)?.team_id);
      return <tr key={entry.id}><td className="draw-team" style={{ borderLeftColor: entryColour(entry.id) }}>{entry.seed || index + 1}. {team?.name || 'Team'}</td><td>{team?.organisation || '—'}</td></tr>;
    })}</tbody></table></section>)}</div></section>}
  </div>;
}

function ScoringMatchCard({ match, divisionName, homeName, awayName, homeColour, awayColour, court, busy, extra, onUpdate }: {
  match: Match; divisionName: string; homeName: string; awayName: string; homeColour: string; awayColour: string;
  court: string; busy: boolean; extra: ReactNode; onUpdate: (change: Partial<Match>) => Promise<void>;
}) {
  const [homeScore, setHomeScore] = useState(match.home_score == null ? '' : String(match.home_score));
  const [awayScore, setAwayScore] = useState(match.away_score == null ? '' : String(match.away_score));
  useEffect(() => {
    setHomeScore(match.home_score == null ? '' : String(match.home_score));
    setAwayScore(match.away_score == null ? '' : String(match.away_score));
  }, [match.home_score, match.away_score]);
  const canStart = match.status === 'scheduled';
  const completed = match.status === 'completed';
  const locked = match.status === 'forfeited';
  async function complete() {
    if (homeScore === '' || awayScore === '' || (!match.home_division_team_id || !match.away_division_team_id)) return;
    if (match.stage !== 'group' && homeScore === awayScore) return;
    if (completed && !window.confirm('This result is already complete. Save the corrected score?')) return;
    await onUpdate({ home_score: Number(homeScore), away_score: Number(awayScore), status: 'completed' });
  }
  return <article className="scoring-card">
    <div className="scoring-card-head"><div className="scoring-context"><span className={`status-pill status-${match.status}`}>{match.status.replace('_', ' ')}</span><strong>{divisionName}</strong><span>{match.stage.replace('_', ' ')}{match.match_number ? ` · Game ${match.match_number}` : ''}</span></div><div className="scoring-place">{match.scheduled_on || 'Time TBC'}{match.starts_at ? ` · ${match.starts_at.slice(0, 5)}` : ''}{court !== '—' ? ` · ${court}` : ''}</div></div>
    <div className="scoring-matchup"><div className="scoring-team"><i style={{ background: homeColour }}/><strong>{homeName}</strong></div><label className="scoring-value home-value"><span className="sr-only">{homeName} score</span><input type="number" inputMode="numeric" min="0" max="100000" aria-label={`${homeName} score`} value={homeScore} onChange={event => setHomeScore(event.target.value)} disabled={busy || locked}/></label><span className="scoring-separator">:</span><label className="scoring-value away-value"><span className="sr-only">{awayName} score</span><input type="number" inputMode="numeric" min="0" max="100000" aria-label={`${awayName} score`} value={awayScore} onChange={event => setAwayScore(event.target.value)} disabled={busy || locked}/></label><div className="scoring-team away"><i style={{ background: awayColour }}/><strong>{awayName}</strong></div></div>
    {!locked && <div className="scoring-card-actions">{canStart && <button type="button" className="secondary-action" disabled={busy} onClick={() => onUpdate({ status: 'in_progress' })}>Start match</button>}<button type="button" disabled={busy || homeScore === '' || awayScore === '' || !match.home_division_team_id || !match.away_division_team_id || (match.stage !== 'group' && homeScore === awayScore)} onClick={complete}>{busy ? 'Saving…' : completed ? 'Update result' : 'Save final score'}</button></div>}
    {locked && <p className="score-validation">Forfeited match. Contact an admin to update it.</p>}{match.stage !== 'group' && homeScore !== '' && awayScore !== '' && homeScore === awayScore && <p className="score-validation">Knockout games need a winner before the result can be saved.</p>}{extra}
  </article>;
}

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
  const [organisers, setOrganisers] = useState<OrganiserAccount[]>([]);
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
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
  const [tab, setTab] = useState<'overview' | 'teams' | 'players' | 'scoring' | 'draw' | 'standings' | 'schedule'>('overview');
  const [scheduleView, setScheduleView] = useState<'draw' | 'table'>('draw');
  const [scoreStatus, setScoreStatus] = useState('all'); const [scoreDivision, setScoreDivision] = useState('');
  const [scoreCourt, setScoreCourt] = useState(''); const [scoreDay, setScoreDay] = useState(''); const [scoreSearch, setScoreSearch] = useState('');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [showSetup, setShowSetup] = useState(false); const [showSignIn, setShowSignIn] = useState(false);
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
  const scoringMatches = tournamentMatches.filter(match => {
    const divisionName = divisions.find(item => item.id === match.division_id)?.name || '';
    const searchText = `${teamName(match.home_division_team_id)} ${teamName(match.away_division_team_id)} ${divisionName} ${courtName(match.court_id, match.court)}`.toLowerCase();
    return (scoreStatus === 'all' || match.status === scoreStatus)
      && (!scoreDivision || match.division_id === scoreDivision)
      && (!scoreCourt || match.court_id === scoreCourt)
      && (!scoreDay || match.scheduled_on === scoreDay)
      && (!scoreSearch.trim() || searchText.includes(scoreSearch.trim().toLowerCase()));
  });
  const organisationName = (team: Team | undefined) => organisations.find(item => item.id === team?.organisation_id)?.name || team?.organisation || '—';
  const organisationKind = tournament?.category === 'regional' ? 'region' : tournament?.category || 'club';
  const organisationLabel = organisationKind[0].toUpperCase() + organisationKind.slice(1);
  const navigation = [
    { id: 'overview', label: 'Dashboard', icon: Home },
    ...(isAdmin ? [{ id: 'teams', label: 'Teams', icon: Users }] : []),
    ...(session ? [{ id: 'players', label: 'Players', icon: Shield }] : []),
    ...(session ? [{ id: 'scoring', label: 'Score matches', icon: ClipboardList }] : []),
    { id: 'draw', label: 'Draw & results', icon: ClipboardList },
    { id: 'standings', label: 'Standings', icon: Trophy },
    { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  ] as const;
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
      const collections: Array<keyof Bootstrap> = ['tournaments','divisions','teams','entries','matches','organisations','courts','tournament_days','day_breaks','schedule_settings','court_availability','division_court_rules','players','rosters','attendance','goals'];
      if (!data || collections.some(key => !Array.isArray(data[key]))) {
        throw new Error('The app loaded, but /api/bootstrap did not return app data. Configure the Cloudflare preview to route /api/* to the NZUWH Worker and its D1 database.');
      }
      setSession(data.viewer); setIsAdmin(data.viewer?.role === 'admin');
      setOrganisers(data.viewer?.role === 'admin' ? await api<OrganiserAccount[]>('users') : []);
      setTournaments(data.tournaments); setDivisions(data.divisions); setTeams(data.teams); setEntries(data.entries);
      setMatches(data.matches); setOrganisations(data.organisations); setPlayers(data.players);
      setCourts(data.courts); setTournamentDays(data.tournament_days); setDivisionCourtRules(data.division_court_rules);
      setRosters(data.rosters); setAttendance(data.attendance); setGoals(data.goals);
      setSelectedTournament(current => current && data.tournaments.some(item => item.id === current) ? current : data.tournaments[0]?.id || '');
    } catch (error) { fail(error); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (session?.role === 'scorer') setTab('scoring'); }, [session?.role]);
  useEffect(() => { setSelectedDivision(current => divisions.some(item => item.id === current && item.tournament_id === selectedTournament) ? current : divisions.find(item => item.tournament_id === selectedTournament)?.id || ''); }, [selectedTournament, divisions]);
  useEffect(() => { setScoreDivision(''); setScoreCourt(''); setScoreDay(''); setScoreSearch(''); }, [selectedTournament]);
  useEffect(() => { setNewTeam(current => ({ ...current, organisation: '' })); }, [selectedTournament]);
  async function save(action: () => Promise<any>) { setBusy(true); setMessage(''); try { await action(); await load(); setMessage('Saved'); } catch (error) { fail(error); } finally { setBusy(false); } }
  async function signIn(event: React.FormEvent) { event.preventDefault(); setMessage(''); setBusy(true); try { await api('login', 'POST', { email, password }); setPassword(''); setShowSignIn(false); await load(); } catch (error) { fail(error); } finally { setBusy(false); } }
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
  async function generateDraw() {
    if (!tournament) return;
    const tournamentDivisions = divisions.filter(item => item.tournament_id === tournament.id);
    const firstPlayingDay = tournamentDays.filter(day => day.tournament_id === tournament.id && day.available).sort((a, b) => a.day_on.localeCompare(b.day_on))[0]?.day_on || tournament.starts_on;
    let nextMatchNumber = Math.max(0, ...tournamentMatches.map(match => match.match_number || 0)) + 1;
    const fixtures: Array<ReturnType<typeof createGroupDraw>[number] & { match_number: number; court_id: null }> = [];
    const created: string[] = [];
    const skipped: string[] = [];
    for (const item of tournamentDivisions) {
      const itemMatches = matches.filter(match => match.division_id === item.id);
      if (itemMatches.length) { skipped.push(`${item.name} already has fixtures`); continue; }
      const itemEntries = entries.filter(entry => entry.division_id === item.id);
      if (itemEntries.length < 2) { skipped.push(`${item.name} needs at least two teams`); continue; }
      const draw = createGroupDraw(item.id, itemEntries, item.round_robins as 1 | 2, firstPlayingDay);
      if (!draw.length) { skipped.push(`${item.name} has no pool pairings`); continue; }
      for (const fixture of draw) fixtures.push({ ...fixture, match_number: nextMatchNumber++, court_id: null });
      created.push(item.name);
    }
    if (!fixtures.length) { setMessage(`No new pool draws created. ${skipped.join('; ') || 'Add divisions and teams first.'}`); return; }
    await save(() => api('matches', 'POST', { matches: fixtures }));
    setTab('draw');
    setMessage(`Created pool draws for ${created.join(', ')}. Generate the tournament schedule to assign times and courts.${skipped.length ? ` Skipped: ${skipped.join('; ')}.` : ''}`);
  }
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
  async function scoreMatch(match: Match, change: Partial<Match>) { await save(() => api(`matches/${match.id}`, 'PATCH', change)); }
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
    if (!canScore || !tournament?.record_goal_scorers || (!match.home_division_team_id && !match.away_division_team_id)) return null;
    return <details className="matchstats"><summary>Attendance and scorers</summary><div className="rostergrid">
      {[match.home_division_team_id, match.away_division_team_id].filter(Boolean).map(entryId =>
        <div key={entryId}><h4>{teamName(entryId)}</h4>{rosters.filter(roster => roster.division_team_id === entryId).map(roster => {
          const attended = attendance.some(row => row.match_id === match.id && row.player_id === roster.player_id);
          const goalCount = goals.filter(goal => goal.match_id === match.id && goal.player_id === roster.player_id).length;
          return <div className="rosterrow" key={roster.id}><label><input type="checkbox" checked={attended} onChange={event => setAttended(match.id, roster.player_id, event.target.checked)}/>{players.find(player => player.id === roster.player_id)?.name}</label>
            <span><button type="button" disabled={!attended} onClick={() => addGoal(match.id, roster.player_id, entryId)}>+ goal</button><b>{goalCount}</b>{goalCount > 0 && <button type="button" onClick={() => removeGoal(match.id, roster.player_id)}>−</button>}</span></div>;
        })}</div>)}</div></details>;
  }
  return <div className={`app ${session ? 'app-authenticated' : ''}`}>
    <header className="masthead"><div className="brand"><span className="brand-mark"><Waves size={22}/></span><div><span className="eyebrow">Underwater Hockey New Zealand</span><h1>Championships dashboard</h1></div></div><div className="account">{session ? <><span>{session.email}<small>{isAdmin ? 'Admin' : 'Scorer'}</small></span><button onClick={signOut}><LogOut size={16}/> <span>Sign out</span></button></> : <span>Public view</span>}</div></header>
    <div className="app-frame has-sidebar">
    <aside className={`sidebar ${session ? 'sidebar-authenticated' : ''}`}><nav className="main-nav" aria-label="Main navigation">{navigation.map(item => { const Icon = item.icon; return <button type="button" key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id as typeof tab)}><Icon size={17}/><span>{item.label}</span></button>; })}</nav><div className="sidebar-footer">{session ? <button type="button" onClick={() => document.querySelector('.account-settings')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><Settings size={16}/> Account settings</button> : <button type="button" className={showSignIn ? 'active' : ''} aria-expanded={showSignIn} onClick={() => setShowSignIn(open => !open)}><LogIn size={16}/>{showSignIn ? 'Close sign in' : 'Organiser sign in'}</button>}</div></aside>
    <div className="workspace">
    {message && <div className="notice" role="status">{message}<button onClick={() => setMessage('')}>×</button></div>}
    {!session && showSignIn && <form className="signin" onSubmit={signIn}><strong>Organiser sign in</strong><input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required/><input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required/><button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form>}
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
      {isAdmin && <section className="organiser-accounts"><div className="sectiontitle"><div><h3>Organiser accounts</h3><p>Set a temporary password. The organiser can change it in account settings after signing in.</p></div></div>
        <div className="organiser-list">{organisers.map(organiser => <form className="organiser-row" key={organiser.id} onSubmit={event => { event.preventDefault(); save(async () => { await api(`users/${organiser.id}/password`, 'POST', { newPassword: resetPasswords[organiser.id] }); setResetPasswords(current => ({ ...current, [organiser.id]: '' })); }); }}>
          <div className="organiser-id"><strong>{organiser.email}</strong><span className="tag">{organiser.role}</span></div>
          <input type="password" autoComplete="new-password" minLength={12} maxLength={256} required placeholder="Temporary password (12+ characters)" value={resetPasswords[organiser.id] || ''} onChange={event => setResetPasswords(current => ({ ...current, [organiser.id]: event.target.value }))}/>
          <button disabled={busy}>Reset password</button>
        </form>)}</div>
      </section>}
    </details>}
    <main>
      <div className="topline"><div><span className="eyebrow">Events</span><h2>Tournaments</h2></div><div className="tournament-actions">{isAdmin && !!tournaments.length && <button onClick={() => setShowSetup(value => !value)}>{showSetup ? 'Close setup' : 'New tournament'}</button>}<select aria-label="Select tournament" value={selectedTournament} onChange={e => setSelectedTournament(e.target.value)}><option value="">Select tournament</option>{tournaments.map(item => <option key={item.id} value={item.id}>{item.name} · {item.starts_on}</option>)}</select></div></div>
      {isAdmin && (showSetup || !tournaments.length) && <TournamentSetup busy={busy} organisations={organisations} teams={teams} onCreate={createTournament}/>}
      {tournament ? <><section className="eventhead"><div><span className="tag">{tournament.category} · {tournament.status}</span><h2>{tournament.name}</h2><p>{tournament.starts_on} to {tournament.ends_on}{tournament.venue ? ` · ${tournament.venue}` : ''} · {tournament.court_count} {tournament.court_count === 1 ? 'court' : 'courts'}</p><p className="scoring-mode">Scoring mode: <strong>{tournament.record_goal_scorers ? 'Team scores and goal scorers' : 'Team scores only'}</strong></p></div>{isAdmin && <label>Status<select value={tournament.status} onChange={e => save(() => api(`tournaments/${tournament.id}`, 'PATCH', { status: e.target.value }))}><option value="draft">Draft</option><option value="published">Published</option><option value="completed">Completed</option></select></label>}</section>
        <div className="divisionbar">{divisions.filter(item => item.tournament_id === tournament.id).map(item => <button className={selectedDivision === item.id ? 'active' : ''} key={item.id} onClick={() => setSelectedDivision(item.id)}>{item.name}</button>)}{isAdmin && <button onClick={() => { const name = prompt('New division name'); if (name?.trim()) save(() => api('divisions', 'POST', { tournament_id: tournament.id, name: name.trim() })); }}>+ Division</button>}</div>
        {tab === 'scoring' && session && <section className="scoring-workspace">
          <div className="scoring-heading"><div><span className="eyebrow">Poolside scoring</span><h2>Match centre</h2><p>Find a fixture, start play, and record the final score.</p></div><span className="scoring-count">{scoringMatches.length} matches</span></div>
          <div className="scoring-filters">
            <label>Match status<select value={scoreStatus} onChange={event => setScoreStatus(event.target.value)}><option value="all">All matches</option><option value="scheduled">Upcoming</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></label>
            <label>Division<select value={scoreDivision} onChange={event => setScoreDivision(event.target.value)}><option value="">All divisions</option>{divisions.filter(item => item.tournament_id === tournament.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Court<select value={scoreCourt} onChange={event => setScoreCourt(event.target.value)}><option value="">All courts</option>{courts.filter(item => item.tournament_id === tournament.id && item.active).map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>
            <label>Day<select value={scoreDay} onChange={event => setScoreDay(event.target.value)}><option value="">All days</option>{Array.from(new Set(tournamentMatches.map(item => item.scheduled_on).filter((value): value is string => !!value))).sort().map(day => <option key={day} value={day}>{day}</option>)}</select></label>
            <label className="scoring-search">Find a team<input type="search" value={scoreSearch} onChange={event => setScoreSearch(event.target.value)} placeholder="Search team or division"/></label>
          </div>
          <div className="scoring-list">{scoringMatches.map(match => <ScoringMatchCard key={match.id} match={match} divisionName={divisions.find(item => item.id === match.division_id)?.name || 'Division'} homeName={teamName(match.home_division_team_id) === 'TBC' ? match.home_placeholder || 'TBC' : teamName(match.home_division_team_id)} awayName={teamName(match.away_division_team_id) === 'TBC' ? match.away_placeholder || 'TBC' : teamName(match.away_division_team_id)} homeColour={teamColour(match.home_division_team_id)} awayColour={teamColour(match.away_division_team_id)} court={courtName(match.court_id, match.court)} busy={busy} extra={tournament.record_goal_scorers ? matchStats(match) : null} onUpdate={change => scoreMatch(match, change)}/>)}{!scoringMatches.length && <div className="panel scoring-empty"><h3>No matches found</h3><p>Try another filter or search term.</p></div>}</div>
        </section>}
        {division && <>
          {tab === 'overview' && <section className="panel"><h3>{division.name} format</h3><div className="metrics"><div><b>{divisionEntries.length}</b><span>Teams</span></div><div><b>{divisionMatches.filter(m => m.stage === 'group').length}</b><span>Pool games</span></div><div><b>{divisionMatches.filter(m => m.stage !== 'group').length}</b><span>Finals and placing</span></div></div>{isAdmin && <div className="formgrid"><label>Pool structure<select value={division.group_count} disabled={divisionEntries.length > 0 || divisionMatches.some(match => match.stage === 'group')} onChange={e => updateDivision({ group_count: Number(e.target.value) })}><option value={1}>One pool</option><option value={2}>Two pools · A and B</option></select></label><label>Round robin<select value={division.round_robins} disabled={divisionMatches.some(match => match.stage === 'group')} onChange={e => updateDivision({ round_robins: Number(e.target.value) })}><option value={1}>Single</option><option value={2}>Double</option></select></label><label>Finals format<select value={division.finals_format} disabled={divisionMatches.some(match => match.stage !== 'group')} onChange={e => updateDivision({ finals_format: e.target.value })}><option value="none">No finals</option>{division.group_count === 1 ? <><option value="top_two">Top two final</option><option value="top_four">Top four semi-finals</option></> : <option value="two_pool_crossover">Crossover quarter-finals · 2nd vs 3rd</option>}<option value="manual">Custom finals</option></select></label></div>}{division.group_count === 2 && division.finals_format === 'two_pool_crossover' && <p className="hint"><strong>Crossover finals:</strong> Pool A seed 2 plays Pool B seed 3, and Pool B seed 2 plays Pool A seed 3 in the quarter-finals. Each pool’s top seed advances directly to a semi-final.</p>}<CourtRulesEditor divisionId={division.id} courts={courts.filter(court => court.tournament_id === tournament.id)} rules={divisionCourtRules} editable={isAdmin && tournament.status === 'draft'} onSave={change => save(() => api(`divisions/${division.id}/court-rules`, 'PUT', change))}/><p className="hint">Set teams and pools, then generate fixtures. The schedule builder will use the saved court rules and playing windows.</p></section>}
          {tab === 'teams' && <section className="panel"><h3>Teams and pools</h3>{isAdmin && !divisionMatches.some(match => match.stage === 'group') && <form className="inlineform" onSubmit={addTeam}><input placeholder="Team name" value={newTeam.name} onChange={e => setNewTeam({ ...newTeam, name: e.target.value })} required/><input list="existing-organisations" required placeholder={organisationLabel} aria-label={organisationLabel} value={newTeam.organisation} onChange={e => setNewTeam({ ...newTeam, organisation: e.target.value })}/><datalist id="existing-organisations">{organisations.filter(item => item.kind === organisationKind).map(item => <option key={item.id} value={item.name}/>)}{organisationKind === 'region' && ['Northern', 'Central', 'Southern'].map(name => <option value={name} key={name}/>)}</datalist><input type="color" title="Team colour" value={newTeam.colour} onChange={e => setNewTeam({ ...newTeam, colour: e.target.value })}/>{division.group_count === 2 && <select value={newTeam.group_name} onChange={e => setNewTeam({ ...newTeam, group_name: e.target.value })}><option value="A">Pool A</option><option value="B">Pool B</option></select>}<button disabled={busy}>Add team</button></form>}<div className="tablewrap"><table><thead><tr><th>Team</th><th>{organisationLabel}</th><th>Pool</th><th>Seed</th></tr></thead><tbody>{divisionEntries.map(entry => { const team = teams.find(item => item.id === entry.team_id); return <tr key={entry.id}><td><i className="swatch" style={{ background: entry.team_colour || team?.colour || '#94a3b8' }}/>{team?.name}</td><td>{organisationName(team)}</td><td>{isAdmin && division.group_count === 2 ? <select value={entry.group_name || 'A'} disabled={divisionMatches.some(match => match.stage === 'group')} onChange={e => save(() => api(`division_teams/${entry.id}`, 'PATCH', { group_name: e.target.value, seed: null }))}><option>A</option><option>B</option></select> : entry.group_name || 'A'}</td><td>{entry.seed || '—'}</td></tr>; })}</tbody></table></div></section>}
          {tab === 'players' && session && <section className="panel"><h3>Team rosters</h3>{isAdmin && <form className="inlineform" onSubmit={addPlayer}><input placeholder="Player name" value={newPlayer.name} onChange={e => setNewPlayer({ ...newPlayer, name: e.target.value })} required/><select value={newPlayer.entry} onChange={e => setNewPlayer({ ...newPlayer, entry: e.target.value })} required><option value="">Choose team</option>{divisionEntries.map(entry => <option key={entry.id} value={entry.id}>{teamName(entry.id)}</option>)}</select><button disabled={busy}>Add player</button></form>}<div className="tablewrap"><table><thead><tr><th>Team</th><th>Player</th></tr></thead><tbody>{rosters.filter(roster => divisionEntries.some(entry => entry.id === roster.division_team_id)).sort((a,b) => teamName(a.division_team_id).localeCompare(teamName(b.division_team_id))).map(roster => <tr key={roster.id}><td>{teamName(roster.division_team_id)}</td><td>{players.find(player => player.id === roster.player_id)?.name}</td></tr>)}</tbody></table></div></section>}
          {tab === 'draw' && <section className="panel">
            <div className="sectiontitle"><div><h3>Draw and results</h3><p>Create pool fixtures across all grades, then schedule the tournament across its courts.</p></div>{isAdmin && <button onClick={generateDraw} disabled={busy}>Generate missing pool draws for all grades</button>}</div>
            {isAdmin && <div className="inlineform secondary">{division.finals_format !== 'none' && division.finals_format !== 'manual' && <button onClick={generateFinals} disabled={busy || !divisionMatches.some(m => m.stage === 'group')}>Generate seeded finals</button>}<select value={manualStage} onChange={e => setManualStage(e.target.value)}><option value="quarter_final">Quarter-final</option><option value="semi_final">Semi-final</option><option value="placement">Placing match</option><option value="final">Final</option></select><button onClick={addFinal}>+ Add knockout / placing game</button></div>}
            <div className="fixtures">{divisionMatches.map(match => <article className="fixture" key={match.id}>
              <div className="fixturemeta"><span className="tag">{match.stage.replace('_', ' ')}</span><span>#{match.match_number || '—'}</span>{isAdmin ? <>
                <MatchScheduleEditor match={match} courts={courts.filter(court => court.tournament_id === tournament.id && court.active)} busy={busy} onSave={change => updateMatch(match, change)}/>
                <input placeholder="Referee" defaultValue={match.referee || ''} onBlur={e => { if (e.target.value !== (match.referee || '')) updateMatch(match, { referee: e.target.value }); }}/>
              </> : <span>{match.scheduled_on} {match.starts_at?.slice(0,5)} {courtName(match.court_id, match.court)} · {match.referee}</span>}</div>
              <div className="fixturebody"><div className="side" style={{ borderColor: teamColour(match.home_division_team_id) }}>{isAdmin ? <select value={match.home_division_team_id || ''} disabled={match.status === 'completed' || attendance.some(row => row.match_id === match.id)} onChange={e => updateMatch(match, { home_division_team_id: e.target.value || null })}><option value="">{match.home_placeholder || 'Select team'}</option>{divisionEntries.map(entry => <option value={entry.id} key={entry.id}>{teamName(entry.id)}</option>)}</select> : teamName(match.home_division_team_id) === 'TBC' ? match.home_placeholder || 'TBC' : teamName(match.home_division_team_id)}</div><span className="versus">v</span><div className="side" style={{ borderColor: teamColour(match.away_division_team_id) }}>{isAdmin ? <select value={match.away_division_team_id || ''} disabled={match.status === 'completed' || attendance.some(row => row.match_id === match.id)} onChange={e => updateMatch(match, { away_division_team_id: e.target.value || null })}><option value="">{match.away_placeholder || 'Select team'}</option>{divisionEntries.map(entry => <option value={entry.id} key={entry.id}>{teamName(entry.id)}</option>)}</select> : teamName(match.away_division_team_id) === 'TBC' ? match.away_placeholder || 'TBC' : teamName(match.away_division_team_id)}</div>{canScore ? <div className="scoreedit"><input type="number" min="0" placeholder="H" defaultValue={match.home_score ?? ''} id={`h-${match.id}`}/><span>:</span><input type="number" min="0" placeholder="A" defaultValue={match.away_score ?? ''} id={`a-${match.id}`}/><button onClick={() => { const h = (document.getElementById(`h-${match.id}`) as HTMLInputElement).value; const a = (document.getElementById(`a-${match.id}`) as HTMLInputElement).value; if (!match.home_division_team_id || !match.away_division_team_id || h === '' || a === '') { setMessage('Select both teams and enter both scores.'); return; } if (match.stage !== 'group' && h === a) { setMessage('Enter the decided knockout result so the winner can advance.'); return; } if (match.status === 'completed' && !window.confirm('This result is already complete. Save the corrected score?')) return; updateMatch(match, { home_score: Number(h), away_score: Number(a), status: 'completed' }); }}>Save score</button></div> : <strong className="score">{match.status === 'completed' ? `${match.home_score} : ${match.away_score}` : '—'}</strong>}</div>{matchStats(match)}
            </article>)}</div>{!divisionMatches.length && <p className="empty">No fixtures yet.</p>}
          </section>}
          {tab === 'standings' && <section className="panel"><h3>Pool standings</h3><div className="tablewrap"><table><thead><tr><th>Pool</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>{rows.map(row => <tr key={row.entry.id}><td>{row.entry.group_name || 'A'}</td><td><i className="swatch" style={{ background: teamColour(row.entry.id) }}/>{teamName(row.entry.id)}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalsFor - row.goalsAgainst}</td><td><strong>{row.points}</strong></td></tr>)}</tbody></table></div><p className="hint">Teams are sorted by points, goal difference, then goals scored. Organisers can enter seeded knockout fixtures in Draw.</p></section>}
          {tab === 'schedule' && <section className="panel schedule">
            <div className="sectiontitle"><div><h3>Tournament draw</h3><p>All divisions, grouped by playing day and court.</p><p className="schedule-summary">{scheduledCount} scheduled · {unscheduledCount} unscheduled{tournamentMatches.some(match => match.schedule_warning) ? ` · ${tournamentMatches.filter(match => match.schedule_warning).length} fallback or warning` : ''}</p></div>
              <div className="schedule-actions">
                <button className="draw-primary-action" onClick={() => window.print()}>Print draw</button>
                {isAdmin && <button disabled={busy || (scheduleHasResults ? !pendingScheduleCount : !tournamentMatches.length)} onClick={generateSchedule}>{scheduleHasResults ? 'Schedule unscheduled fixtures' : scheduledCount ? 'Rebuild schedule' : 'Generate schedule'}</button>}
                <button onClick={exportSchedule}>Export CSV</button>
              </div>
            </div>
            {isAdmin && scheduleHasResults && <p className="hint">Rebuilding the existing schedule is locked after play starts; newly added unscheduled fixtures can still be placed.</p>}
            <div className="schedule-view-toggle" role="group" aria-label="Schedule display"><button type="button" className={scheduleView === 'draw' ? 'active' : ''} onClick={() => setScheduleView('draw')}>Draw view</button><button type="button" className={scheduleView === 'table' ? 'active' : ''} onClick={() => setScheduleView('table')}>Table view</button></div>
            <div className={scheduleView === 'table' ? 'draw-screen-hidden' : ''}><TournamentDrawSheet tournament={tournament} matches={tournamentMatches} divisions={divisions} courts={courts} days={tournamentDays} entries={entries} teams={teams}/></div>
            {scheduleView === 'table' && <div className="tablewrap"><table><thead><tr><th>Date</th><th>Time</th><th>Court</th><th>Game</th><th>Division</th><th>Stage</th><th>White</th><th>Score</th><th>Black</th><th>Score</th><th>Referee</th><th>Schedule notes</th></tr></thead><tbody>{tournamentMatches.map(match => <tr key={match.id}><td>{match.scheduled_on || '—'}</td><td>{match.starts_at?.slice(0, 5) || '—'}</td><td>{courtName(match.court_id, match.court)}</td><td>{match.match_number || '—'}</td><td>{divisions.find(d => d.id === match.division_id)?.name}</td><td>{match.stage.replace('_', ' ')}</td><td>{teamName(match.home_division_team_id) === 'TBC' ? match.home_placeholder || 'TBC' : teamName(match.home_division_team_id)}</td><td>{match.home_score ?? ''}</td><td>{teamName(match.away_division_team_id) === 'TBC' ? match.away_placeholder || 'TBC' : teamName(match.away_division_team_id)}</td><td>{match.away_score ?? ''}</td><td>{match.referee || '—'}</td><td>{match.schedule_issue || match.schedule_warning || '—'}</td></tr>)}</tbody></table></div>}
          </section>}
        </>}
      </> : <section className="panel empty">No tournaments yet. An admin can create the first championship above.</section>}
    </main>
    </div></div>
  </div>;
}
