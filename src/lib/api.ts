export type Viewer = { id: string; email: string; role: 'admin' | 'scorer' };
export type Bootstrap = { viewer: Viewer | null; tournaments: any[]; divisions: any[]; teams: any[]; entries: any[]; matches: any[]; organisations: any[]; courts: any[]; tournament_days: any[]; day_breaks: any[]; schedule_settings: any[]; court_availability: any[]; division_court_rules: any[]; players: any[]; rosters: any[]; attendance: any[]; goals: any[] };
export async function api<T = any>(path: string, method = 'GET', value?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method, credentials: 'same-origin',
    headers: value === undefined ? {} : { 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
