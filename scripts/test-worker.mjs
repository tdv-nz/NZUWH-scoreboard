import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { build } from 'esbuild';

await build({ entryPoints: ['worker/index.ts'], outfile: '/private/tmp/nzuwh-worker-test.mjs', bundle: true, format: 'esm', platform: 'browser' });
const worker = (await import('/private/tmp/nzuwh-worker-test.mjs')).default;
const database = new DatabaseSync(':memory:');
database.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
const db = {
  prepare(sql) {
    const statement = database.prepare(sql);
    return {
      bind(...values) {
        return {
          async first() { return statement.get(...values) || null; },
          async all() { return { results: statement.all(...values), success: true }; },
          async run() { const result = statement.run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
        };
      },
      async first() { return statement.get() || null; },
      async all() { return { results: statement.all(), success: true }; },
      async run() { const result = statement.run(); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
  },
  async batch(statements) {
    database.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); database.exec('COMMIT'); return results; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  },
};
const env = { DB: db, ASSETS: { fetch: async () => new Response('asset') } };
const email = 'admin@example.com'; const password = 'very-long-admin-password';
const salt = randomBytes(16).toString('hex');
const hash = pbkdf2Sync(password, Buffer.from(salt, 'hex'), 220000, 32, 'sha512').toString('hex');
database.prepare('INSERT INTO organisers (id,email,role,password_salt,password_hash,password_iterations) VALUES (?,?,?,?,?,?)')
  .run(randomUUID(), email, 'admin', salt, hash, 220000);
let cookie = '';
async function call(path, method = 'GET', value, authenticated = true) {
  const headers = { Origin: 'https://scoreboard.test' };
  if (value !== undefined) headers['Content-Type'] = 'application/json';
  if (authenticated && cookie) headers.Cookie = cookie;
  const response = await worker.fetch(new Request(`https://scoreboard.test/api/${path}`, { method, headers, body: value === undefined ? undefined : JSON.stringify(value) }), env);
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
}
test('private data needs sign-in; login establishes session', async () => {
  assert.equal((await call('bootstrap')).body.viewer, null);
  assert.equal((await call('tournaments', 'POST', {}, false)).status, 401);
  assert.equal((await call('login', 'POST', { email, password: 'wrong' })).status, 401);
  const result = await call('login', 'POST', { email, password });
  assert.equal(result.status, 200);
  cookie = result.cookie.split(';')[0];
  assert.equal((await call('bootstrap')).body.viewer.role, 'admin');
});
test('tournament, fixtures, attendance and advancement', async () => {
  const draft = { name: '2026 Club Nationals', category: 'club', starts_on: '2026-10-02', ends_on: '2026-10-03', venue: 'Wellington', court_count: 2,
    divisions: [{ name: 'Premier', group_count: 1, round_robins: 1, finals_format: 'top_two', teams: [
      { name: 'Sharks', organisation: 'Nova', colour: '#0000ff', group_name: 'A' },
      { name: 'Stingrays', organisation: 'Nova', colour: '#00ff00', group_name: 'A' },
    ] }] };
  const created = await call('tournaments', 'POST', draft); assert.equal(created.status, 201, JSON.stringify(created.body));
  const privateData = (await call('bootstrap')).body;
  assert.equal(privateData.organisations.length, 1);
  assert.equal(privateData.teams.length, 2);
  assert.equal((await call('bootstrap', 'GET', undefined, false)).body.tournaments.length, 0);
  assert.equal((await call(`tournaments/${created.body.id}`, 'PATCH', { status: 'published' })).status, 200);
  assert.equal((await call('bootstrap', 'GET', undefined, false)).body.tournaments.length, 1);
  const [first, second] = privateData.entries;
  const matchId = randomUUID();
  const match = { id: matchId, division_id: privateData.divisions[0].id, stage: 'group', scheduled_on: '2026-10-02', home_division_team_id: first.id, away_division_team_id: second.id };
  assert.equal((await call('matches', 'POST', { matches: [match] })).status, 201);
  assert.equal((await call('players', 'POST', { name: 'Player One', division_team_id: first.id })).status, 201);
  const playerId = (await call('bootstrap')).body.players[0].id;
  assert.equal((await call('attendance', 'POST', { match_id: matchId, player_id: playerId })).status, 200);
  const goal = await call('goals', 'POST', { match_id: matchId, player_id: playerId, division_team_id: first.id });
  assert.equal(goal.status, 201);
  assert.equal((await call('attendance', 'DELETE', { match_id: matchId, player_id: playerId })).status, 409);
  assert.equal((await call(`goals/${goal.body.id}`, 'DELETE')).status, 200);
  assert.equal((await call('attendance', 'DELETE', { match_id: matchId, player_id: playerId })).status, 200);
  assert.equal((await call(`matches/${matchId}`, 'PATCH', { home_score: 2, away_score: 1, status: 'completed' })).status, 200);
  const finalId = randomUUID();
  assert.equal((await call('matches', 'POST', { matches: [{ id: finalId, division_id: privateData.divisions[0].id, stage: 'final', home_source_match_id: matchId, home_source_outcome: 'winner', away_source_match_id: matchId, away_source_outcome: 'loser' }] })).status, 201);
  assert.equal((await call(`matches/${matchId}`, 'PATCH', { home_score: 1, away_score: 2 })).status, 200);
  const final = database.prepare('SELECT * FROM matches WHERE id=?').get(finalId);
  assert.equal(final.home_division_team_id, second.id);
  assert.equal(final.away_division_team_id, first.id);
});

test('scorer can record results but cannot change event structure', async () => {
  database.prepare('INSERT INTO organisers (id,email,role,password_salt,password_hash,password_iterations) VALUES (?,?,?,?,?,?)')
    .run(randomUUID(), 'scorer@example.com', 'scorer', salt, hash, 220000);
  const adminCookie = cookie;
  const signIn = await call('login', 'POST', { email: 'scorer@example.com', password });
  assert.equal(signIn.status, 200);
  cookie = signIn.cookie.split(';')[0];
  const result = await call('bootstrap');
  const match = result.body.matches[0];
  assert.equal(result.body.viewer.role, 'scorer');
  assert.equal((await call(`matches/${match.id}`, 'PATCH', { referee: 'Someone' })).status, 403);
  assert.equal((await call(`matches/${match.id}`, 'PATCH', { home_score: 3, away_score: 1 })).status, 200);
  assert.equal((await call('divisions', 'POST', { tournament_id: result.body.tournaments[0].id, name: 'New' })).status, 403);
  cookie = adminCookie;
});

test('cross-origin writes fail and sign-out invalidates the session', async () => {
  const response = await worker.fetch(new Request('https://scoreboard.test/api/tournaments', {
    method: 'POST', headers: { Origin: 'https://other.test', Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  }), env);
  assert.equal(response.status, 403);
  assert.equal((await call('logout', 'POST')).status, 200);
  assert.equal((await call('bootstrap')).body.viewer, null);
});
