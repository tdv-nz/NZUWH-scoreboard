import { useMemo, useState } from 'react';

export type FinalsFormat = '' | 'none' | 'top_two' | 'top_four' | 'two_pool_crossover' | 'manual';
export type CourtAllocation = 'any' | 'required' | 'preferred';
export type TeamDraft = { id: string; reuse_team_id: string; name: string; organisation: string; colour: string; group_name: 'A' | 'B' };
export type CourtDraft = { id: string; display_name: string; active: boolean };
export type TimeWindow = { starts_at: string; ends_at: string };
export type DayDraft = {
  day_on: string;
  available: boolean;
  starts_at: string;
  ends_at: string;
  breaks: Array<TimeWindow & { label: string }>;
  court_availability: Array<{ court_id: string; windows: TimeWindow[] }>;
};
export type DivisionDraft = {
  name: string;
  group_count: 1 | 2;
  round_robins: 1 | 2;
  finals_format: FinalsFormat;
  court_rule: { allocation_type: CourtAllocation; court_ids: string[] };
  teams: TeamDraft[];
};
export type TournamentDraft = {
  name: string;
  category: 'school' | 'regional' | 'club';
  starts_on: string;
  ends_on: string;
  venue: string;
  court_count: number;
  courts: CourtDraft[];
  days: DayDraft[];
  schedule: {
    match_duration_minutes: number;
    halftime_minutes: number;
    gap_between_games_minutes: number;
    team_turnaround_minutes: number;
  };
  record_goal_scorers: boolean;
  divisions: DivisionDraft[];
};
export type Organisation = { id: string; kind: 'school' | 'region' | 'club'; name: string };
export type ExistingTeam = { id: string; name: string; organisation_id: string | null; colour: string | null };

const grades: Record<TournamentDraft['category'], string[]> = {
  school: ['Junior Boys', 'Junior Girls', 'Senior Boys', 'Senior Girls'],
  regional: ['Elite Men', 'Elite Women', 'Under 18 Men', 'Under 18 Women'],
  club: ['Premier', 'A Grade', 'B Grade', 'C Grade', 'Women’s', 'Novice'],
};
const dateToday = (() => { const today = new Date(); return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`; })();
const blankTeam = (): TeamDraft => ({ id: crypto.randomUUID(), reuse_team_id: '', name: '', organisation: '', colour: '#0891b2', group_name: 'A' });
const blankCourt = (index: number): CourtDraft => ({ id: crypto.randomUUID(), display_name: `Court ${index + 1}`, active: true });
const blankDivision = (name: string): DivisionDraft => ({ name, group_count: 1, round_robins: 1, finals_format: '', court_rule: { allocation_type: 'any', court_ids: [] }, teams: [blankTeam(), blankTeam()] });
function dateList(start: string, end: string): string[] {
  if (!start || !end || end < start) return [];
  const result: string[] = [];
  for (let cursor = new Date(`${start}T00:00:00Z`); cursor <= new Date(`${end}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    result.push(cursor.toISOString().slice(0, 10));
    if (result.length >= 500) break;
  }
  return result;
}
function blankDay(day_on: string, courts: CourtDraft[]): DayDraft {
  return { day_on, available: true, starts_at: '09:00', ends_at: '17:00', breaks: [],
    court_availability: courts.filter(court => court.active).map(court => ({ court_id: court.id, windows: [{ starts_at: '09:00', ends_at: '17:00' }] })) };
}
function blankTournament(): TournamentDraft {
  const courts = [blankCourt(0), blankCourt(1)];
  return { name: '', category: 'club', starts_on: dateToday, ends_on: dateToday, venue: '', court_count: 2, courts,
    days: [blankDay(dateToday, courts)],
    schedule: { match_duration_minutes: 20, halftime_minutes: 2, gap_between_games_minutes: 0, team_turnaround_minutes: 20 },
    record_goal_scorers: false, divisions: [] };
}
const orderWindows = (windows: TimeWindow[]) => [...windows].sort((a, b) => a.starts_at.localeCompare(b.starts_at));

export default function TournamentSetup({ busy, organisations, teams, onCreate }: { busy: boolean; organisations: Organisation[]; teams: ExistingTeam[]; onCreate: (draft: TournamentDraft) => Promise<boolean> }) {
  const [draft, setDraft] = useState<TournamentDraft>(blankTournament);
  const [customGrade, setCustomGrade] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);
  const organisationKind = draft.category === 'regional' ? 'region' : draft.category;
  const organisationLabel = organisationKind[0].toUpperCase() + organisationKind.slice(1);
  const organisationSuggestions = useMemo(() => [...new Set([
    ...organisations.filter(item => item.kind === organisationKind).map(item => item.name),
    ...draft.divisions.flatMap(division => division.teams.map(team => team.organisation.trim()).filter(Boolean)),
    ...(organisationKind === 'region' ? ['Northern', 'Central', 'Southern'] : []),
  ])].sort((a, b) => a.localeCompare(b)), [draft.divisions, organisationKind, organisations]);
  const reusableTeams = teams.filter(team => organisations.find(organisation => organisation.id === team.organisation_id)?.kind === organisationKind);
  const activeCourts = draft.courts.filter(court => court.active);

  function updateDivision(index: number, change: Partial<DivisionDraft>) {
    setDraft(current => ({ ...current, divisions: current.divisions.map((division, i) => i === index ? { ...division, ...change } : division) }));
  }
  function moveDivisionCourt(index: number, courtId: string, delta: number) {
    const division = draft.divisions[index];
    const selected = [...division.court_rule.court_ids];
    const from = selected.indexOf(courtId); const to = from + delta;
    if (from < 0 || to < 0 || to >= selected.length) return;
    [selected[from], selected[to]] = [selected[to], selected[from]];
    updateDivision(index, { court_rule: { ...division.court_rule, court_ids: selected } });
  }
  function updateTeam(divisionIndex: number, teamId: string, change: Partial<TeamDraft>) {
    setDraft(current => ({ ...current, divisions: current.divisions.map((division, i) => i === divisionIndex ? {
      ...division, teams: division.teams.map(team => team.id === teamId ? { ...team, ...change } : team),
    } : division) }));
  }
  function setTournamentDates(starts_on: string, ends_on: string) {
    setDraft(current => {
      const daysByDate = new Map(current.days.map(day => [day.day_on, day]));
      const days = dateList(starts_on, ends_on).map(date => daysByDate.get(date) || blankDay(date, current.courts));
      return { ...current, starts_on, ends_on, days };
    });
  }
  function updateCourt(courtId: string, change: Partial<CourtDraft>) {
    setDraft(current => {
      const courts = current.courts.map(court => court.id === courtId ? { ...court, ...change } : court);
      const updated = courts.find(court => court.id === courtId)!;
      return { ...current, courts, court_count: courts.filter(court => court.active).length,
        days: current.days.map(day => {
          let court_availability = day.court_availability;
          if (!updated.active) court_availability = court_availability.filter(item => item.court_id !== courtId);
          else if (!court_availability.some(item => item.court_id === courtId)) court_availability = [...court_availability,
            { court_id: courtId, windows: [{ starts_at: day.starts_at, ends_at: day.ends_at }] }];
          return { ...day, court_availability };
        }) };
    });
  }
  function addCourt() {
    if (draft.courts.length >= 20) return;
    const court = blankCourt(draft.courts.length);
    setDraft(current => ({ ...current, courts: [...current.courts, court], court_count: current.court_count + 1,
      days: current.days.map(day => ({ ...day, court_availability: [...day.court_availability,
        { court_id: court.id, windows: [{ starts_at: day.starts_at, ends_at: day.ends_at }] }] })) }));
  }
  function removeCourt(courtId: string) {
    setDraft(current => {
      const courts = current.courts.filter(court => court.id !== courtId);
      return { ...current, courts, court_count: courts.filter(court => court.active).length,
        days: current.days.map(day => ({ ...day, court_availability: day.court_availability.filter(item => item.court_id !== courtId) })),
        divisions: current.divisions.map(division => ({ ...division,
          court_rule: { ...division.court_rule, court_ids: division.court_rule.court_ids.filter(id => id !== courtId) } })) };
    });
  }
  function updateDay(index: number, change: Partial<DayDraft>) {
    setDraft(current => ({ ...current, days: current.days.map((day, i) => {
      if (i !== index) return day;
      const next = { ...day, ...change };
      if (change.starts_at || change.ends_at) {
        next.court_availability = next.court_availability.map(item => ({ ...item,
          windows: item.windows.map(window => ({
            starts_at: window.starts_at === day.starts_at ? next.starts_at : window.starts_at,
            ends_at: window.ends_at === day.ends_at ? next.ends_at : window.ends_at,
          })) }));
      }
      return next;
    }) }));
  }
  function updateCourtWindows(dayIndex: number, courtId: string, windows: TimeWindow[]) {
    setDraft(current => ({ ...current, days: current.days.map((day, index) => index !== dayIndex ? day : ({ ...day,
      court_availability: day.court_availability.some(item => item.court_id === courtId)
        ? day.court_availability.map(item => item.court_id === courtId ? { ...item, windows } : item)
        : [...day.court_availability, { court_id: courtId, windows }],
    })) }));
  }

  function validateEvent() {
    if (!draft.name.trim()) return 'Enter a tournament name.';
    if (!draft.starts_on || !draft.ends_on || draft.ends_on < draft.starts_on) return 'The last day must be on or after the first day.';
    return '';
  }
  function validateCourts() {
    if (!draft.courts.length || !activeCourts.length) return 'Keep at least one active court.';
    if (draft.courts.length > 20) return 'A tournament can have up to 20 courts.';
    if (draft.courts.some(court => !court.display_name.trim())) return 'Give every court a name.';
    if (new Set(draft.courts.map(court => court.display_name.trim().toLocaleLowerCase())).size !== draft.courts.length) return 'Court names must be unique.';
    return '';
  }
  function validateDivisions() {
    if (!draft.divisions.length) return 'Choose at least one division.';
    for (const division of draft.divisions) {
      const names = division.teams.map(team => team.name.trim());
      if (names.length < 2 || names.some(name => !name)) return `Add at least two named teams to ${division.name}.`;
      if (division.teams.some(team => !team.organisation.trim())) return `Choose a ${organisationKind} for every team in ${division.name}.`;
      if (new Set(names.map(name => name.toLocaleLowerCase())).size !== names.length) return `Team names in ${division.name} must be unique.`;
      if (!division.finals_format) return `Choose a finals format for ${division.name}.`;
      const a = division.teams.filter(team => team.group_name === 'A').length;
      const b = division.teams.filter(team => team.group_name === 'B').length;
      if (division.group_count === 2 && (a < 2 || b < 2)) return `${division.name} needs at least two teams in each pool.`;
      if (division.finals_format === 'two_pool_crossover' && (a < 3 || b < 3)) return `${division.name} needs at least three teams in each pool for crossover finals.`;
      if (division.finals_format === 'top_four' && division.teams.length < 4) return `${division.name} needs at least four teams for top-four finals.`;
      if (division.court_rule.allocation_type === 'any' && division.court_rule.court_ids.length) return `${division.name} can use any court or a court rule, not both.`;
      if (division.court_rule.allocation_type !== 'any' && !division.court_rule.court_ids.length) return `Choose at least one court for the ${division.court_rule.allocation_type} rule in ${division.name}.`;
      if (division.court_rule.court_ids.some(id => !activeCourts.some(court => court.id === id))) return `${division.name} court rules must use active courts.`;
    }
    return '';
  }
  function validateSchedule() {
    if (!draft.days.length || !draft.days.some(day => day.available)) return 'Choose at least one available playing day.';
    for (const day of draft.days) {
      if (day.ends_at <= day.starts_at) return `Finish time must follow start time on ${day.day_on}.`;
      if (!day.available) continue;
      const breaks = orderWindows(day.breaks);
      if (breaks.some(item => item.starts_at < day.starts_at || item.ends_at > day.ends_at || item.ends_at <= item.starts_at)) return `Check the break times on ${day.day_on}.`;
      if (breaks.some((item, index) => index > 0 && item.starts_at < breaks[index - 1].ends_at)) return `Breaks overlap on ${day.day_on}.`;
      for (const court of activeCourts) {
        const windows = orderWindows(day.court_availability.find(item => item.court_id === court.id)?.windows || []);
        if (windows.some(item => item.starts_at < day.starts_at || item.ends_at > day.ends_at || item.ends_at <= item.starts_at)) return `Check ${court.display_name} availability on ${day.day_on}.`;
        if (windows.some((item, index) => index > 0 && item.starts_at < windows[index - 1].ends_at)) return `${court.display_name} availability overlaps on ${day.day_on}.`;
      }
    }
    return '';
  }
  function nextStep() {
    const problem = [validateEvent(), validateCourts(), validateDivisions(), validateSchedule()][step];
    if (problem) { setError(problem); return; }
    setError(''); setStep(current => Math.min(3, current + 1));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validateSchedule();
    if (problem) { setError(problem); return; }
    const payload: TournamentDraft = {
      ...draft,
      court_count: activeCourts.length,
      days: draft.days.map(day => ({ ...day, court_availability: day.available ? day.court_availability : [] })),
    };
    setError('');
    if (await onCreate(payload)) { setDraft(blankTournament()); setCustomGrade(''); setStep(0); }
  }

  return <section className="panel setup">
    <div className="sectiontitle"><div><span className="eyebrow">Guided setup · Step {step + 1} of 4</span><h2>Create tournament</h2><p className="hint">New tournaments start in Draft and stay private until published.</p></div>
      <div className="wizard-steps" aria-label="Setup steps">{['Event', 'Courts', 'Divisions', 'Schedule & review'].map((label, index) => <button type="button" key={label} className={index === step ? 'active' : ''} onClick={() => { if (index <= step) { setStep(index); setError(''); } }}>{label}</button>)}</div>
    </div>
    <form onSubmit={submit}>
      {step === 0 && <div className="setup-step"><h3>Event details</h3><div className="formgrid">
        <label>Tournament name<input required value={draft.name} placeholder="2026 National Inter Club Championship" onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
        <label>Tournament type<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as TournamentDraft['category'], divisions: [] })}><option value="school">School</option><option value="regional">Regional</option><option value="club">Club</option></select></label>
        <label>First day<input required type="date" value={draft.starts_on} onChange={event => setTournamentDates(event.target.value, draft.ends_on)}/></label>
        <label>Last day<input required type="date" min={draft.starts_on} value={draft.ends_on} onChange={event => setTournamentDates(draft.starts_on, event.target.value)}/></label>
        <label>Venue<input value={draft.venue} onChange={event => setDraft({ ...draft, venue: event.target.value })}/></label>
      </div><p className="hint">A team entry must belong to a school, region, or club that matches this tournament type.</p></div>}

      {step === 1 && <div className="setup-step"><h3>Courts</h3><p className="hint">Courts are saved as named tournament records. You can deactivate a court without deleting its history.</p>
        <div className="court-drafts">{draft.courts.map((court, index) => <div className="court-draft" key={court.id}>
          <span className="team-number">{index + 1}</span><label>Court name<input aria-label={`Court ${index + 1} name`} value={court.display_name} onChange={event => updateCourt(court.id, { display_name: event.target.value })}/></label>
          <label className="inline-check"><input type="checkbox" checked={court.active} onChange={event => updateCourt(court.id, { active: event.target.checked })}/>Active</label>
          <button type="button" aria-label={`Remove ${court.display_name}`} disabled={draft.courts.length <= 1} onClick={() => removeCourt(court.id)}>Remove</button>
        </div>)}</div>
        <button type="button" onClick={addCourt} disabled={draft.courts.length >= 20}>+ Add court</button>
        <p className="hint">{activeCourts.length} active {activeCourts.length === 1 ? 'court' : 'courts'} will be available to this tournament.</p>
      </div>}

      {step === 2 && <>
        <div className="setup-step"><h3>Divisions</h3><p className="hint">Choose the grades contested at this tournament.</p>
          <div className="checks">{grades[draft.category].map(name => <label key={name}><input type="checkbox" checked={draft.divisions.some(division => division.name === name)} onChange={event => event.target.checked
            ? setDraft(current => ({ ...current, divisions: [...current.divisions, blankDivision(name)] }))
            : setDraft(current => ({ ...current, divisions: current.divisions.filter(division => division.name !== name) }))}/>{name}</label>)}</div>
          <div className="inlineform"><input aria-label="Custom division name" placeholder="Other division name" value={customGrade} onChange={event => setCustomGrade(event.target.value)}/><button type="button" disabled={!customGrade.trim() || draft.divisions.some(division => division.name.toLocaleLowerCase() === customGrade.trim().toLocaleLowerCase())} onClick={() => { setDraft(current => ({ ...current, divisions: [...current.divisions, blankDivision(customGrade.trim())] })); setCustomGrade(''); }}>+ Add division</button></div>
        </div>
        {draft.divisions.map((division, index) => <div className="division-setup" key={division.name}>
          <div className="sectiontitle"><div><span className="eyebrow">Division setup</span><h3>{division.name}</h3></div><button type="button" onClick={() => setDraft(current => ({ ...current, divisions: current.divisions.filter((_, i) => i !== index) }))}>Remove division</button></div>
          <div className="formgrid">
            <label>Pools<select value={division.group_count} onChange={event => { const group_count = Number(event.target.value) as 1 | 2; updateDivision(index, { group_count, finals_format: '', teams: division.teams.map((team, teamIndex) => ({ ...team, group_name: group_count === 1 ? 'A' : teamIndex % 2 === 0 ? 'A' : 'B' })) }); }}><option value={1}>One pool</option><option value={2}>Two pools</option></select></label>
            <label>Round robin<select value={division.round_robins} onChange={event => updateDivision(index, { round_robins: Number(event.target.value) as 1 | 2 })}><option value={1}>Single · play each team once</option><option value={2}>Double · play each team twice</option></select></label>
            <label>Finals format<select value={division.finals_format} onChange={event => updateDivision(index, { finals_format: event.target.value as FinalsFormat })}><option value="">Choose finals format</option><option value="none">No finals</option>{division.group_count === 1 ? <><option value="top_two">Top-two final</option><option value="top_four">Top-four semifinals and final</option></> : <option value="two_pool_crossover">Two-pool crossover</option>}<option value="manual">Custom finals and placement games</option></select></label>
            <label>Court allocation<select value={division.court_rule.allocation_type} onChange={event => { const allocation_type = event.target.value as CourtAllocation; updateDivision(index, { court_rule: { allocation_type, court_ids: allocation_type === 'any' ? [] : division.court_rule.court_ids } }); }}><option value="any">Any active court</option><option value="required">Required courts only</option><option value="preferred">Preferred courts, fallback allowed</option></select></label>
          </div>
          {division.court_rule.allocation_type !== 'any' && <fieldset className="court-rule"><legend>{division.court_rule.allocation_type === 'required' ? 'Allowed courts' : 'Preferred court order'}</legend><p className="hint">{division.court_rule.allocation_type === 'required' ? 'Games in this division can only use the selected courts.' : 'Select courts in preference order. The schedule may use another active court if needed.'}</p>
            <div className="court-rule-list">{activeCourts.map(court => { const selected = division.court_rule.court_ids.includes(court.id); const rank = division.court_rule.court_ids.indexOf(court.id); return <div className="court-rule-row" key={court.id}><label><input type="checkbox" checked={selected} onChange={event => updateDivision(index, { court_rule: { ...division.court_rule, court_ids: event.target.checked ? [...division.court_rule.court_ids, court.id] : division.court_rule.court_ids.filter(id => id !== court.id) } })}/>{division.court_rule.allocation_type === 'preferred' && selected ? `${rank + 1}. ` : ''}{court.display_name}</label>{selected && division.court_rule.allocation_type === 'preferred' && <span><button type="button" aria-label={`Move ${court.display_name} preference up`} disabled={rank === 0} onClick={() => moveDivisionCourt(index, court.id, -1)}>↑</button><button type="button" aria-label={`Move ${court.display_name} preference down`} disabled={rank === division.court_rule.court_ids.length - 1} onClick={() => moveDivisionCourt(index, court.id, 1)}>↓</button></span>}</div>; })}</div>
          </fieldset>}
          <h4>Teams</h4><p className="hint">Reuse the organisation across grades. Returning team names are matched within that organisation.</p>
          <div className="team-drafts">{division.teams.map((team, teamIndex) => <div className="team-draft" key={team.id}>
            <span className="team-number">{teamIndex + 1}</span>
            <select className="existing-team-select" aria-label={`${division.name} team ${teamIndex + 1} reuse existing team`} value={team.reuse_team_id} onChange={event => {
              const existing = reusableTeams.find(item => item.id === event.target.value);
              const organisation = existing && organisations.find(item => item.id === existing.organisation_id);
              updateTeam(index, team.id, existing && organisation
                ? { reuse_team_id: existing.id, name: existing.name, organisation: organisation.name, colour: existing.colour || team.colour }
                : { reuse_team_id: '' });
            }}><option value="">Create or match team</option>{reusableTeams.map(existing => <option value={existing.id} key={existing.id}>{organisations.find(item => item.id === existing.organisation_id)?.name} · {existing.name}</option>)}</select>
            <input aria-label={`${division.name} team ${teamIndex + 1} name`} required placeholder="Team name" value={team.name} onChange={event => updateTeam(index, team.id, { name: event.target.value, reuse_team_id: '' })}/>
            <input className="team-organisation-input" aria-label={`${division.name} team ${teamIndex + 1} ${organisationLabel}`} list="tournament-organisation-options" required placeholder={organisationLabel} value={team.organisation} onChange={event => updateTeam(index, team.id, { organisation: event.target.value, reuse_team_id: '' })}/>
            <input aria-label={`${division.name} team ${teamIndex + 1} colour`} title="Team colour" type="color" value={team.colour} onChange={event => updateTeam(index, team.id, { colour: event.target.value })}/>
            {division.group_count === 2 && <select aria-label={`${division.name} team ${teamIndex + 1} pool`} value={team.group_name} onChange={event => updateTeam(index, team.id, { group_name: event.target.value as 'A' | 'B' })}><option value="A">Pool A</option><option value="B">Pool B</option></select>}
            <button type="button" aria-label={`Remove ${team.name || `team ${teamIndex + 1}`}`} disabled={division.teams.length <= 2} onClick={() => updateDivision(index, { teams: division.teams.filter(item => item.id !== team.id) })}>×</button>
          </div>)}</div><button type="button" onClick={() => updateDivision(index, { teams: [...division.teams, blankTeam()] })}>+ Add team</button>
        </div>)}
        <datalist id="tournament-organisation-options">{organisationSuggestions.map(name => <option value={name} key={name}/>)}</datalist>
      </>}

      {step === 3 && <>
        <div className="setup-step"><h3>Schedule defaults</h3><p className="hint">These values are stored for the later draw and scheduling step.</p><div className="formgrid">
          <label>Match duration (minutes)<input type="number" min="1" max="240" value={draft.schedule.match_duration_minutes} onChange={event => setDraft(current => ({ ...current, schedule: { ...current.schedule, match_duration_minutes: Number(event.target.value) } }))}/></label>
          <label>Halftime (minutes)<input type="number" min="0" max="60" value={draft.schedule.halftime_minutes} onChange={event => setDraft(current => ({ ...current, schedule: { ...current.schedule, halftime_minutes: Number(event.target.value) } }))}/></label>
          <label>Gap between games (minutes)<input type="number" min="0" max="180" value={draft.schedule.gap_between_games_minutes} onChange={event => setDraft(current => ({ ...current, schedule: { ...current.schedule, gap_between_games_minutes: Number(event.target.value) } }))}/></label>
          <label>Minimum team turnaround (minutes)<input type="number" min="0" max="720" value={draft.schedule.team_turnaround_minutes} onChange={event => setDraft(current => ({ ...current, schedule: { ...current.schedule, team_turnaround_minutes: Number(event.target.value) } }))}/></label>
        </div></div>
        <div className="setup-step"><h3>Available playing days</h3>{draft.days.map((day, dayIndex) => <article className="day-setup" key={day.day_on}>
          <div className="sectiontitle"><h4>{day.day_on}</h4><label className="inline-check"><input type="checkbox" checked={day.available} onChange={event => updateDay(dayIndex, { available: event.target.checked })}/>Playing day</label></div>
          <div className="formgrid"><label>Start time<input type="time" value={day.starts_at} onChange={event => updateDay(dayIndex, { starts_at: event.target.value })}/></label><label>Finish time<input type="time" value={day.ends_at} onChange={event => updateDay(dayIndex, { ends_at: event.target.value })}/></label></div>
          {day.available && <>
            <h5>Court availability</h5>{activeCourts.map(court => {
              const availability = day.court_availability.find(item => item.court_id === court.id);
              const window = availability?.windows[0];
              return <div className="court-window" key={court.id}><label className="inline-check"><input type="checkbox" checked={!!availability?.windows.length} onChange={event => updateCourtWindows(dayIndex, court.id, event.target.checked ? [{ starts_at: day.starts_at, ends_at: day.ends_at }] : [])}/>{court.display_name} available</label>
                {window && <><label>From<input aria-label={`${court.display_name} available from on ${day.day_on}`} type="time" value={window.starts_at} onChange={event => updateCourtWindows(dayIndex, court.id, [{ ...window, starts_at: event.target.value }])}/></label><label>Until<input aria-label={`${court.display_name} available until on ${day.day_on}`} type="time" value={window.ends_at} onChange={event => updateCourtWindows(dayIndex, court.id, [{ ...window, ends_at: event.target.value }])}/></label></>}
              </div>;
            })}
            <h5>Breaks</h5>{day.breaks.map((item, breakIndex) => <div className="court-window" key={`${breakIndex}-${item.starts_at}`}><label>Break name<input value={item.label} onChange={event => updateDay(dayIndex, { breaks: day.breaks.map((row, index) => index === breakIndex ? { ...row, label: event.target.value } : row) })}/></label><label>From<input type="time" value={item.starts_at} onChange={event => updateDay(dayIndex, { breaks: day.breaks.map((row, index) => index === breakIndex ? { ...row, starts_at: event.target.value } : row) })}/></label><label>Until<input type="time" value={item.ends_at} onChange={event => updateDay(dayIndex, { breaks: day.breaks.map((row, index) => index === breakIndex ? { ...row, ends_at: event.target.value } : row) })}/></label><button type="button" onClick={() => updateDay(dayIndex, { breaks: day.breaks.filter((_, index) => index !== breakIndex) })}>Remove break</button></div>)}
            <button type="button" onClick={() => updateDay(dayIndex, { breaks: [...day.breaks, { starts_at: '12:00', ends_at: '12:30', label: 'Break' }] })}>+ Add break</button>
          </>}
        </article>)}</div>
        <div className="setup-step"><h3>Scoring mode</h3><label className="inline-check"><input type="checkbox" checked={draft.record_goal_scorers} onChange={event => setDraft({ ...draft, record_goal_scorers: event.target.checked })}/>Record individual goal scorers</label><p className="hint">{draft.record_goal_scorers ? 'Scorers can record player goals and unattributed team goals.' : 'The tournament records team scores only. Tournament rosters are still retained.'}</p></div>
        <section className="setup-review"><h3>Review</h3><p><strong>{draft.name || 'Untitled tournament'}</strong> · {draft.category} · {draft.starts_on} to {draft.ends_on}</p><p>{activeCourts.length} active courts · {draft.divisions.length} divisions · {draft.days.filter(day => day.available).length} playing days · {draft.record_goal_scorers ? 'Team scores and goal scorers' : 'Team scores only'}</p><p className="hint">Status: Draft. Review the tournament once it has been created, then publish it when ready.</p></section>
      </>}

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="wizard-actions">{step > 0 && <button type="button" onClick={() => { setStep(current => current - 1); setError(''); }}>Back</button>}{step < 3 ? <button type="button" className="create-button" onClick={nextStep}>Continue</button> : <button className="create-button" disabled={busy || !draft.divisions.length}>{busy ? 'Creating tournament…' : 'Create Draft tournament'}</button>}</div>
    </form>
  </section>;
}
