import { ApiError, json, requireChoice, requireText, type Env, type Viewer } from './types';

const COOKIE = 'nzuwh_session';
export const PASSWORD_ITERATIONS = 220_000;
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex: string) => new Uint8Array(hex.match(/.{2}/g)?.map(part => parseInt(part, 16)) || []);
const randomHex = (length: number) => bytesToHex(crypto.getRandomValues(new Uint8Array(length)));

export async function passwordHash(password: string, saltHex: string, iterations = PASSWORD_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt: hexToBytes(saltHex), iterations }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}
export async function newPassword(password: unknown): Promise<{ salt: string; hash: string; iterations: number }> {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new ApiError(400, 'Password must be 12–256 characters');
  const salt = randomHex(16);
  return { salt, hash: await passwordHash(password, salt), iterations: PASSWORD_ITERATIONS };
}
async function sha256(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function cookieValue(request: Request): string | null {
  const raw = request.headers.get('Cookie') || '';
  const match = raw.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
  return match ? match.slice(COOKIE.length + 1) : null;
}
function sessionCookie(request: Request, token: string, maxAge = SESSION_SECONDS): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
export async function viewer(request: Request, env: Env): Promise<Viewer | null> {
  const token = cookieValue(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return env.DB.prepare(`SELECT o.id, o.email, o.role FROM sessions s JOIN organisers o ON o.id = s.organiser_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP`).bind(await sha256(token)).first<Viewer>();
}
export function requireAdmin(user: Viewer | null): asserts user is Viewer {
  if (!user || user.role !== 'admin') throw new ApiError(403, 'Admin access required');
}
export async function login(request: Request, env: Env, input: Record<string, unknown>): Promise<Response> {
  const email = requireText(input.email, 'Email', 254).toLowerCase();
  const password = input.password;
  if (typeof password !== 'string' || !password || password.length > 256) throw new ApiError(400, 'Password is required');
  const user = await env.DB.prepare('SELECT * FROM organisers WHERE email = ?').bind(email).first<Viewer & {
    password_salt: string; password_hash: string; password_iterations: number; failed_logins: number; locked_until: string | null;
  }>();
  if (user?.locked_until && user.locked_until > new Date().toISOString().replace('T', ' ').slice(0, 19)) throw new ApiError(429, 'Too many attempts. Try again later.');
  const actual = await passwordHash(password, user?.password_salt || '00000000000000000000000000000000', user?.password_iterations || PASSWORD_ITERATIONS);
  if (!user || !equalHex(actual, user.password_hash)) {
    if (user) await env.DB.prepare(`UPDATE organisers SET failed_logins = failed_logins + 1,
      locked_until = CASE WHEN failed_logins + 1 >= 5 THEN datetime('now', '+15 minutes') ELSE NULL END WHERE id = ?`).bind(user.id).run();
    throw new ApiError(401, 'Invalid email or password');
  }
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  await env.DB.batch([
    env.DB.prepare('UPDATE organisers SET failed_logins = 0, locked_until = NULL WHERE id = ?').bind(user.id),
    env.DB.prepare("INSERT INTO sessions (token_hash, organiser_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))").bind(tokenHash, user.id),
  ]);
  return json({ viewer: { id: user.id, email: user.email, role: user.role } }, 200, { 'Set-Cookie': sessionCookie(request, token) });
}
export async function logout(request: Request, env: Env): Promise<Response> {
  const token = cookieValue(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
}
export async function createOrganiser(env: Env, input: Record<string, unknown>): Promise<Response> {
  const email = requireText(input.email, 'Email', 254).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, 'Invalid email');
  const role = requireChoice(input.role, 'role', ['admin', 'scorer'] as const);
  const { salt, hash, iterations } = await newPassword(input.password);
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO organisers (id, email, role, password_salt, password_hash, password_iterations) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, email, role, salt, hash, iterations).run();
  return json({ id, email, role }, 201);
}
export async function changePassword(env: Env, user: Viewer, input: Record<string, unknown>): Promise<Response> {
  const current = input.currentPassword;
  if (typeof current !== 'string' || !current || current.length > 256) throw new ApiError(400, 'Current password is required');
  const record = await env.DB.prepare('SELECT password_salt, password_hash, password_iterations FROM organisers WHERE id = ?').bind(user.id)
    .first<{ password_salt: string; password_hash: string; password_iterations: number }>();
  if (!record || !equalHex(await passwordHash(current, record.password_salt, record.password_iterations), record.password_hash)) throw new ApiError(401, 'Current password is incorrect');
  const { salt, hash, iterations } = await newPassword(input.newPassword);
  await env.DB.batch([
    env.DB.prepare('UPDATE organisers SET password_salt = ?, password_hash = ?, password_iterations = ? WHERE id = ?').bind(salt, hash, iterations, user.id),
    env.DB.prepare('DELETE FROM sessions WHERE organiser_id = ?').bind(user.id),
  ]);
  return json({ ok: true });
}
