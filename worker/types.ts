export type BindValue = string | number | null;
export interface Statement {
  bind(...values: BindValue[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ success: boolean; meta: { changes: number } }>;
}
export interface Database {
  prepare(query: string): Statement;
  batch(statements: Statement[]): Promise<Array<{ success: boolean; results: Record<string, unknown>[] }>>;
}
export interface Env {
  DB: Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
}
export interface Viewer { id: string; email: string; role: 'admin' | 'scorer' }
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const json = (value: unknown, status = 200, headers: HeadersInit = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
export function requireText(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ApiError(400, `${label} is required and must be under ${max} characters`);
  return value.trim();
}
export function requireChoice<T extends string>(value: unknown, label: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new ApiError(400, `Invalid ${label}`);
  return value as T;
}
export function requireInteger(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new ApiError(400, `Invalid ${label}`);
  return value as number;
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'JSON body required');
  if (Number(request.headers.get('content-length')) > 200_000) throw new ApiError(413, 'Request too large');
  const value = await request.json().catch(() => { throw new ApiError(400, 'Invalid JSON'); });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'JSON object required');
  return value as Record<string, unknown>;
}
export function sameOrigin(request: Request): void {
  if (!['POST','PATCH','PUT','DELETE'].includes(request.method)) return;
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin) throw new ApiError(403, 'Cross-origin writes are not allowed');
}
