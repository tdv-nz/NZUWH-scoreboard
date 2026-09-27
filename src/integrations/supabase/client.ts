import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
if (!url || !key) throw new Error('Configure the championships Supabase URL and publishable key in .env.local.');
if (new URL(url).hostname === 'cxjcruhlogcltvlovjhs.supabase.co') throw new Error('Use a separate Supabase project for championships.');
export const supabase = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
