import { useState } from 'react';

export type FinalsFormat = '' | 'none' | 'top_two' | 'top_four' | 'two_pool_crossover' | 'manual';
export type TeamDraft = { id: string; name: string; organisation: string; colour: string; group_name: 'A' | 'B' };
export type DivisionDraft = { name: string; group_count: 1 | 2; round_robins: 1 | 2; finals_format: FinalsFormat; teams: TeamDraft[] };
export type TournamentDraft = { name: string; category: 'school' | 'regional' | 'club'; starts_on: string; ends_on: string; venue: string; court_count: number; divisions: DivisionDraft[] };
export type Organisation = { id: string; kind: 'school' | 'region' | 'club'; name: string };

const grades: Record<TournamentDraft['category'], string[]> = {
  school: ['Junior Boys', 'Junior Girls', 'Senior Boys', 'Senior Girls'],
  regional: ['Elite Men', 'Elite Women', 'U18 Men', 'U18 Women'],
  club: ['Premier', 'A', 'B', 'C', 'Women’s', 'Novice'],
};
const dateToday = new Date().toISOString().slice(0, 10);
const blankTeam = (): TeamDraft => ({ id: crypto.randomUUID(), name: '', organisation: '', colour: '#0891b2', group_name: 'A' });
const blankDivision = (name: string): DivisionDraft => ({ name, group_count: 1, round_robins: 1, finals_format: '', teams: [blankTeam(), blankTeam()] });
const blankTournament = (): TournamentDraft => ({ name: '', category: 'club', starts_on: dateToday, ends_on: dateToday, venue: '', court_count: 2, divisions: [] });

export default function TournamentSetup({ busy, organisations, onCreate }: { busy: boolean; organisations: Organisation[]; onCreate: (draft: TournamentDraft) => Promise<boolean> }) {
  const [draft, setDraft] = useState<TournamentDraft>(blankTournament);
  const [customGrade, setCustomGrade] = useState('');
  const [error, setError] = useState('');
  const organisationKind = draft.category === 'regional' ? 'region' : draft.category;
  const organisationLabel = organisationKind[0].toUpperCase() + organisationKind.slice(1);
  const organisationSuggestions = [...new Set([
    ...organisations.filter(item => item.kind === organisationKind).map(item => item.name),
    ...draft.divisions.flatMap(division => division.teams.map(team => team.organisation.trim()).filter(Boolean)),
    ...(organisationKind === 'region' ? ['Northern', 'Central', 'Southern'] : []),
  ])].sort((a, b) => a.localeCompare(b));
  const updateDivision = (index: number, change: Partial<DivisionDraft>) => setDraft(current => ({ ...current,
    divisions: current.divisions.map((division, i) => i === index ? { ...division, ...change } : division) }));
  const addGrade = (name: string) => setDraft(current => ({ ...current, divisions: [...current.divisions, blankDivision(name)] }));
  function updateTeam(divisionIndex: number, teamId: string, change: Partial<TeamDraft>) {
    setDraft(current => ({ ...current, divisions: current.divisions.map((division, i) => i === divisionIndex ? {
      ...division, teams: division.teams.map(team => team.id === teamId ? { ...team, ...change } : team),
    } : division) }));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (!draft.divisions.length) { setError('Choose at least one division.'); return; }
    if (draft.ends_on < draft.starts_on) { setError('The last day must be on or after the first day.'); return; }
    for (const division of draft.divisions) {
      const names = division.teams.map(team => team.name.trim());
      if (names.length < 2 || names.some(name => !name)) { setError(`Add at least two named teams to ${division.name}.`); return; }
      if (division.teams.some(team => !team.organisation.trim())) { setError(`Choose a ${organisationKind} for every team in ${division.name}.`); return; }
      if (new Set(names.map(name => name.toLowerCase())).size !== names.length) { setError(`Team names in ${division.name} must be unique.`); return; }
      if (!division.finals_format) { setError(`Choose a finals format for ${division.name}.`); return; }
      const a = division.teams.filter(team => team.group_name === 'A').length;
      const b = division.teams.filter(team => team.group_name === 'B').length;
      if (division.group_count === 2 && (a < 2 || b < 2)) { setError(`${division.name} needs at least two teams in each pool.`); return; }
      if (division.finals_format === 'two_pool_crossover' && (a < 3 || b < 3)) { setError(`${division.name} needs at least three teams in each pool for crossover finals.`); return; }
      if (division.finals_format === 'top_four' && division.teams.length < 4) { setError(`${division.name} needs at least four teams for top-four finals.`); return; }
    }
    if (await onCreate(draft)) { setDraft(blankTournament()); setCustomGrade(''); }
  }
  return <section className="panel setup"><h2>Create tournament</h2><p className="hint">Set the event, its divisions, teams and formats before creating the draw.</p><form onSubmit={submit}>
    <datalist id="tournament-organisation-options">{organisationSuggestions.map(name => <option value={name} key={name}/>)}</datalist>
    <div className="setup-step"><h3>1. Event and courts</h3><div className="formgrid">
      <label>Tournament name<input required value={draft.name} placeholder="2026 National Inter Club Championship" onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
      <label>Type<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as TournamentDraft['category'], divisions: [] })}><option value="school">School</option><option value="regional">Regional</option><option value="club">Club</option></select></label>
      <label>First day<input required type="date" value={draft.starts_on} onChange={event => setDraft({ ...draft, starts_on: event.target.value })}/></label>
      <label>Last day<input required type="date" min={draft.starts_on} value={draft.ends_on} onChange={event => setDraft({ ...draft, ends_on: event.target.value })}/></label>
      <label>Venue<input value={draft.venue} onChange={event => setDraft({ ...draft, venue: event.target.value })}/></label>
      <label>Number of courts<input required type="number" min="1" max="20" value={draft.court_count} onChange={event => setDraft({ ...draft, court_count: Number(event.target.value) })}/></label>
    </div></div>
    <div className="setup-step"><h3>2. Divisions</h3><p className="hint">Choose the grades running at this tournament.</p><div className="checks">{grades[draft.category].map(name => <label key={name}><input type="checkbox" checked={draft.divisions.some(division => division.name === name)} onChange={event => event.target.checked ? addGrade(name) : setDraft(current => ({ ...current, divisions: current.divisions.filter(division => division.name !== name) }))}/>{name}</label>)}</div>
      <div className="inlineform"><input aria-label="Custom division name" placeholder="Other division name" value={customGrade} onChange={event => setCustomGrade(event.target.value)}/><button type="button" disabled={!customGrade.trim() || draft.divisions.some(division => division.name.toLowerCase() === customGrade.trim().toLowerCase())} onClick={() => { addGrade(customGrade.trim()); setCustomGrade(''); }}>+ Add division</button></div>
    </div>
    {draft.divisions.map((division, index) => <div className="division-setup" key={division.name}>
      <div className="sectiontitle"><div><span className="eyebrow">3. Format and teams</span><h3>{division.name}</h3></div><button type="button" onClick={() => setDraft(current => ({ ...current, divisions: current.divisions.filter((_, i) => i !== index) }))}>Remove division</button></div>
      <div className="formgrid"><label>Pools<select value={division.group_count} onChange={event => updateDivision(index, { group_count: Number(event.target.value) as 1 | 2, finals_format: '', teams: division.teams.map(team => ({ ...team, group_name: 'A' })) })}><option value={1}>One pool</option><option value={2}>Two pools</option></select></label>
        <label>Round robin<select value={division.round_robins} onChange={event => updateDivision(index, { round_robins: Number(event.target.value) as 1 | 2 })}><option value={1}>Single: play each team once</option><option value={2}>Double: play each team twice</option></select></label>
        <label>Finals format<select required value={division.finals_format} onChange={event => updateDivision(index, { finals_format: event.target.value as FinalsFormat })}><option value="">Choose finals format</option><option value="none">No finals; pool standings decide</option>{division.group_count === 1 ? <><option value="top_two">Top two play a final</option><option value="top_four">Top four: semi-finals, final, third place</option></> : <option value="two_pool_crossover">Crossover: second v third, then semi-finals</option>}<option value="manual">Custom finals and placing games</option></select></label></div>
      <h4>Teams</h4><p className="hint">Use the same {organisationKind} name for its teams in different grades. Existing names are suggested as you type.</p><div className="team-drafts">{division.teams.map((team, teamIndex) => <div className="team-draft" key={team.id}>
        <span className="team-number">{teamIndex + 1}</span><input aria-label={`${division.name} team ${teamIndex + 1} name`} required placeholder="Team name" value={team.name} onChange={event => updateTeam(index, team.id, { name: event.target.value })}/>
        <input className="team-organisation-input" aria-label={`${division.name} team ${teamIndex + 1} ${organisationLabel}`} list="tournament-organisation-options" required placeholder={organisationLabel} value={team.organisation} onChange={event => updateTeam(index, team.id, { organisation: event.target.value })}/>
        <input aria-label={`${division.name} team ${teamIndex + 1} colour`} title="Team colour" type="color" value={team.colour} onChange={event => updateTeam(index, team.id, { colour: event.target.value })}/>
        {division.group_count === 2 && <select aria-label={`${division.name} team ${teamIndex + 1} pool`} value={team.group_name} onChange={event => updateTeam(index, team.id, { group_name: event.target.value as 'A' | 'B' })}><option value="A">Pool A</option><option value="B">Pool B</option></select>}
        <button type="button" aria-label={`Remove ${team.name || `team ${teamIndex + 1}`}`} disabled={division.teams.length <= 2} onClick={() => updateDivision(index, { teams: division.teams.filter(item => item.id !== team.id) })}>×</button>
      </div>)}</div><button type="button" onClick={() => updateDivision(index, { teams: [...division.teams, blankTeam()] })}>+ Add team</button>
    </div>)}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="create-button" disabled={busy || !draft.divisions.length}>{busy ? 'Creating tournament…' : 'Create tournament'}</button>
  </form></section>;
}
