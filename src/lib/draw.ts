export type GroupTeam = { id: string; group_name: string | null; seed: number | null };
export type DraftFixture = {
  division_id: string;
  stage: 'group';
  round_number: number;
  match_number: number;
  home_division_team_id: string;
  away_division_team_id: string;
  scheduled_on: string;
  status: 'scheduled';
};

function roundRobin(teamIds: string[]): [string, string][][] {
  const ids = [...teamIds];
  if (ids.length % 2) ids.push('');
  const rounds: [string, string][][] = [];
  for (let round = 0; round < ids.length - 1; round++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < ids.length / 2; i++) {
      const a = ids[i];
      const b = ids[ids.length - 1 - i];
      if (a && b) pairs.push(round % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    ids.splice(1, 0, ids.pop()!);
  }
  return rounds;
}

export function createGroupDraw(divisionId: string, teams: GroupTeam[], legs: 1 | 2, startsOn: string): DraftFixture[] {
  const groups = [...new Set(teams.map(team => team.group_name || 'A'))].sort();
  const groupRounds = groups.map(group => roundRobin(teams.filter(team => (team.group_name || 'A') === group)
    .sort((a, b) => (a.seed || 999) - (b.seed || 999)).map(team => team.id)));
  const roundCount = Math.max(...groupRounds.map(rounds => rounds.length), 0);
  const fixtures: DraftFixture[] = [];
  for (let leg = 0; leg < legs; leg++) {
    for (let round = 0; round < roundCount; round++) {
      for (const rounds of groupRounds) {
        for (const [first, second] of rounds[round] || []) {
          const [home, away] = leg ? [second, first] : [first, second];
          fixtures.push({ division_id: divisionId, stage: 'group', round_number: leg * roundCount + round + 1,
            match_number: fixtures.length + 1, home_division_team_id: home, away_division_team_id: away,
            scheduled_on: startsOn, status: 'scheduled' });
        }
      }
    }
  }
  return fixtures;
}
