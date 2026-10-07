import type { SyncTable } from '@/services/storage/types';
import type { CaptureTable } from '@/services/capture/storage/types';

export type RemoteTable = SyncTable | CaptureTable;

/** Ligne telle que stockée côté serveur (snake_case). */
export interface RemoteRow {
  id: string;
  version?: number;
  server_updated_at?: string;
  deleted_at?: string | null;
  [column: string]: unknown;
}

export type PushResult =
  | { ok: true; row: RemoteRow }
  | { ok: false; reason: 'conflict'; server: RemoteRow | null };

/** Erreur « pas de réseau » (≠ erreur applicative) : la synchronisation est simplement reportée. */
export class NetworkError extends Error {
  constructor(message = 'Réseau indisponible') { super(message); this.name = 'NetworkError'; }
}

/**
 * Contrat du stockage distant. Implémentations : Supabase (production) et en mémoire (tests / mode démo hors-ligne).
 * L'application ne parle jamais directement à Supabase en dehors de `supabaseRemote.ts`.
 */
export interface RemoteStore {
  /** Lignes modifiées depuis `cursor` (`server_updated_at >= cursor`), triées par `server_updated_at`. */
  pull(table: RemoteTable, cursor: string | null, limit: number): Promise<RemoteRow[]>;
  /** Création : échoue en `conflict` si l'id existe déjà. */
  insert(table: SyncTable, row: RemoteRow): Promise<PushResult>;
  /** Mise à jour conditionnelle (verrou optimiste) : `conflict` si la version serveur n'est plus `baseVersion`. */
  update(table: SyncTable, row: RemoteRow, baseVersion: number): Promise<PushResult>;
  /** Envoi idempotent (tables de capture : l'id est la clé). */
  upsertMany(table: CaptureTable, rows: RemoteRow[]): Promise<void>;
  /** Suppression « douce » : l'autre appareil verra `deleted_at`. */
  softDelete(table: RemoteTable, id: string): Promise<void>;
  touchDevice(deviceId: string, info: string): Promise<void>;
}

export const VERSIONED_TABLES: SyncTable[] = ['subjects', 'modules', 'course_sessions', 'study_artifacts'];
/** Ordre d'envoi/réception : les parents avant les enfants (clés étrangères). */
export const CAPTURE_TABLES: CaptureTable[] = ['transcript_sessions', 'transcript_segments', 'timeline_markers', 'note_anchors', 'capture_interruptions'];
