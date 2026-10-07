import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaptureTable } from '@/services/capture/storage/types';
import type { SyncTable } from '@/services/storage/types';
import { NetworkError, type PushResult, type RemoteRow, type RemoteStore, type RemoteTable } from './types';

/** Distingue « pas de réseau » d'une vraie erreur serveur (RLS, contrainte…). */
function classify(err: { message?: string; code?: string; status?: number } | null | undefined): Error {
  const msg = err?.message ?? 'Erreur inconnue';
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg) || err?.status === 0) return new NetworkError(msg);
  return new Error(msg);
}

/**
 * Implémentation Supabase (PostgREST). C'est le SEUL fichier qui connaît les requêtes de données.
 * La sécurité ne repose pas sur ce code : elle est garantie par la Row Level Security (voir supabase/migrations).
 */
export class SupabaseRemote implements RemoteStore {
  constructor(private client: SupabaseClient, private userId: string) {}

  async pull(table: RemoteTable, cursor: string | null, limit: number): Promise<RemoteRow[]> {
    let q = this.client.from(table).select('*').eq('user_id', this.userId).order('server_updated_at', { ascending: true }).limit(limit);
    if (cursor) q = q.gte('server_updated_at', cursor);
    const { data, error } = await q;
    if (error) throw classify(error);
    return (data ?? []) as RemoteRow[];
  }

  async insert(table: SyncTable, row: RemoteRow): Promise<PushResult> {
    const { data, error } = await this.client.from(table).upsert(row, { onConflict: 'id', ignoreDuplicates: true }).select();
    if (error) throw classify(error);
    if (data && data.length) return { ok: true, row: data[0] as RemoteRow };
    return { ok: false, reason: 'conflict', server: await this.fetchOne(table, row.id) };
  }

  async update(table: SyncTable, row: RemoteRow, baseVersion: number): Promise<PushResult> {
    const { id, user_id: _u, created_at: _c, ...patch } = row;
    const { data, error } = await this.client.from(table).update(patch).eq('id', id).eq('user_id', this.userId).eq('version', baseVersion).select();
    if (error) throw classify(error);
    if (data && data.length) return { ok: true, row: data[0] as RemoteRow };
    return { ok: false, reason: 'conflict', server: await this.fetchOne(table, id) };
  }

  async upsertMany(table: CaptureTable, rows: RemoteRow[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.client.from(table).upsert(rows, { onConflict: 'id' });
    if (error) throw classify(error);
  }

  async softDelete(table: RemoteTable, id: string): Promise<void> {
    const { error } = await this.client.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', this.userId);
    if (error) throw classify(error);
  }

  async touchDevice(deviceId: string, info: string): Promise<void> {
    const { error } = await this.client.from('sync_metadata').upsert({ user_id: this.userId, device_id: deviceId, last_sync_at: new Date().toISOString(), client_info: info }, { onConflict: 'user_id,device_id' });
    if (error) throw classify(error);
  }

  private async fetchOne(table: RemoteTable, id: string): Promise<RemoteRow | null> {
    const { data, error } = await this.client.from(table).select('*').eq('id', id).eq('user_id', this.userId).maybeSingle();
    if (error) throw classify(error);
    return (data as RemoteRow | null) ?? null;
  }
}
