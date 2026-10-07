export interface SupabaseUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
  user: SupabaseUser;
}

const FALLBACK_URL = 'https://ylggagkweyzorhjbihyq.supabase.co';
const FALLBACK_KEY = 'sb_publishable_WG7SiNLKkXHYbJKaKfjslg_jjIOQRlB';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL).replace(/\/$/, '');
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || FALLBACK_KEY;

export class SupabaseHttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
    this.name = 'SupabaseHttpError';
  }
}

async function parseResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export async function supabaseFetch<T>(
  path: string,
  options: RequestInit & { accessToken?: string } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('apikey', SUPABASE_PUBLISHABLE_KEY);
  if (options.accessToken) headers.set('Authorization', 'Bearer ' + options.accessToken);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(SUPABASE_URL + path, { ...options, headers });
  const body = await parseResponse(res);
  if (!res.ok) {
    const obj = body && typeof body === 'object' ? body as Record<string, unknown> : null;
    const message = String(obj?.msg ?? obj?.message ?? obj?.error_description ?? obj?.error ?? ('Erreur Supabase (' + res.status + ')'));
    throw new SupabaseHttpError(res.status, message, body);
  }
  return body as T;
}

export async function signUp(email: string, password: string, firstName: string): Promise<{ user: SupabaseUser | null; session: SupabaseSession | null }> {
  const redirectTo = typeof window !== 'undefined' ? window.location.origin + '/login' : undefined;
  const query = redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : '';
  const data = await supabaseFetch<Record<string, unknown>>('/auth/v1/signup' + query, {
    method: 'POST',
    body: JSON.stringify({ email, password, data: { first_name: firstName } }),
  });
  const session = data.access_token ? normalizeSession(data) : null;
  return { user: (data.user as SupabaseUser | undefined) ?? session?.user ?? null, session };
}

export async function signInWithPassword(email: string, password: string): Promise<SupabaseSession> {
  const data = await supabaseFetch<Record<string, unknown>>('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return normalizeSession(data);
}

export async function refreshAuthSession(refreshToken: string): Promise<SupabaseSession> {
  const data = await supabaseFetch<Record<string, unknown>>('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return normalizeSession(data);
}

export async function signOut(accessToken: string): Promise<void> {
  await supabaseFetch('/auth/v1/logout', { method: 'POST', accessToken }).catch(() => undefined);
}

export async function sendPasswordReset(email: string): Promise<void> {
  const redirectTo = typeof window !== 'undefined' ? window.location.origin + '/reset-password' : undefined;
  const query = redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : '';
  await supabaseFetch('/auth/v1/recover' + query, { method: 'POST', body: JSON.stringify({ email }) });
}

export async function updatePassword(accessToken: string, password: string): Promise<void> {
  await supabaseFetch('/auth/v1/user', { method: 'PUT', accessToken, body: JSON.stringify({ password }) });
}

function normalizeSession(data: Record<string, unknown>): SupabaseSession {
  const access = String(data.access_token ?? '');
  const refresh = String(data.refresh_token ?? '');
  const expiresIn = Number(data.expires_in ?? 3600);
  const expiresAt = Number(data.expires_at ?? Math.floor(Date.now() / 1000) + expiresIn);
  const user = data.user as SupabaseUser | undefined;
  if (!access || !refresh || !user?.id) throw new Error('Session Supabase invalide.');
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: expiresIn,
    expires_at: expiresAt,
    token_type: String(data.token_type ?? 'bearer'),
    user,
  };
}

export async function restSelect<T>(table: string, query: string, accessToken: string): Promise<T[]> {
  return supabaseFetch<T[]>('/rest/v1/' + table + '?' + query, { accessToken });
}

export async function restUpsert<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  accessToken: string,
): Promise<void> {
  if (!rows.length) return;
  await supabaseFetch('/rest/v1/' + table + '?on_conflict=id', {
    method: 'POST',
    accessToken,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
}

export async function restPatch(
  table: string,
  filter: string,
  patch: Record<string, unknown>,
  accessToken: string,
): Promise<void> {
  await supabaseFetch('/rest/v1/' + table + '?' + filter, {
    method: 'PATCH',
    accessToken,
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
}

export async function deleteOwnAccount(accessToken: string): Promise<void> {
  await supabaseFetch('/functions/v1/delete-account', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ confirmation: 'SUPPRIMER' }),
  });
}
