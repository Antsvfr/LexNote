// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * Vérifie la VRAIE sécurité côté base (Row Level Security) sur un Postgres réel (PGlite = Postgres en WASM) :
 * le schéma SQL de production est rejoué tel quel, avec un petit « shim » de ce que Supabase fournit
 * (schéma auth, auth.uid(), rôles anon / authenticated).
 */
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let db: PGlite;

async function as(user: string | null, fn: () => Promise<unknown>) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
  `);
  await db.exec(readFileSync('supabase/migrations/20261007000000_lexnote_init.sql', 'utf8'));
  await db.exec(`insert into auth.users values ('${A}', 'a@test.fr'), ('${B}', 'b@test.fr');`);
});

const insertSubject = (id: string, name: string, userId?: string) =>
  q(`insert into subjects (id, name${userId ? ', user_id' : ''}) values ($1, $2${userId ? ', $3' : ''})`, userId ? [id, name, userId] : [id, name]);

describe('Row Level Security — isolation des utilisateurs', () => {
  it('à l’inscription, un profil est créé automatiquement', async () => {
    const r = await q('select id from public.profiles order by email');
    expect(r.rows.map((x) => (x as { id: string }).id)).toEqual([A, B]);
  });

  it('A crée « Droit » ; B ne le voit pas ; A le voit', async () => {
    await as(A, () => insertSubject(uuid(1), 'Droit'));
    expect((await as(B, () => q('select * from subjects')) as { rows: unknown[] }).rows).toHaveLength(0);
    expect((await as(A, () => q('select * from subjects')) as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it('B crée « Finance » ; A ne le voit pas', async () => {
    await as(B, () => insertSubject(uuid(2), 'Finance'));
    const a = await as(A, () => q<{ name: string }>('select name from subjects')) as { rows: { name: string }[] };
    expect(a.rows.map((r) => r.name)).toEqual(['Droit']);
    const b = await as(B, () => q<{ name: string }>('select name from subjects')) as { rows: { name: string }[] };
    expect(b.rows.map((r) => r.name)).toEqual(['Finance']);
  });

  it('B ne peut ni modifier ni supprimer les données de A (0 ligne affectée)', async () => {
    const upd = await as(B, () => q(`update subjects set name = 'piraté' where id = $1`, [uuid(1)])) as { affectedRows: number };
    expect(upd.affectedRows).toBe(0);
    const del = await as(B, () => q(`delete from subjects where id = $1`, [uuid(1)])) as { affectedRows: number };
    expect(del.affectedRows).toBe(0);
    const r = await as(A, () => q<{ name: string }>('select name from subjects where id = $1', [uuid(1)])) as { rows: { name: string }[] };
    expect(r.rows[0]?.name).toBe('Droit');
  });

  it('B ne peut pas insérer une ligne au nom de A (with check)', async () => {
    await expect(as(B, () => insertSubject(uuid(3), 'Usurpation', A))).rejects.toThrow(/row-level security/i);
  });

  it('un utilisateur ne peut pas « donner » une ligne à un autre en changeant user_id', async () => {
    await expect(as(A, () => q(`update subjects set user_id = $1 where id = $2`, [B, uuid(1)]))).rejects.toThrow();
  });

  it('clé étrangère composite : B ne peut pas rattacher un module au sujet de A, même en connaissant son id', async () => {
    await expect(as(B, () => q(`insert into modules (id, subject_id, name) values ($1, $2, 'intrus')`, [uuid(10), uuid(1)]))).rejects.toThrow(/foreign key|violates/i);
  });

  it('chaîne complète pour A : sujet → module → séance → transcription → marqueur → ancrage', async () => {
    await as(A, async () => {
      await q(`insert into modules (id, subject_id, name) values ($1, $2, 'Droit des contrats')`, [uuid(11), uuid(1)]);
      await q(`insert into course_sessions (id, subject_id, module_id, type, number, title, date, notes_content) values ($1,$2,$3,'TD',1,'Cas pratique','2026-10-07', '{"type":"doc"}')`, [uuid(20), uuid(1), uuid(11)]);
      await q(`insert into transcript_sessions (id, session_id, origin_at) values ($1,$1, now())`, [uuid(20)]);
      await q(`insert into transcript_segments (id, session_id, start_ms, end_ms, text, provider) values ($1,$2,0,1000,'le dol','webspeech')`, [uuid(30), uuid(20)]);
      await q(`insert into timeline_markers (id, session_id, at_ms, reasons) values ($1,$2,500,'{exam}')`, [uuid(31), uuid(20)]);
      await q(`insert into note_anchors (id, session_id, timestamp_ms, note_position, nearby_segment_ids) values ($1,$2,500,3,$3)`, [uuid(32), uuid(20), `{${uuid(30)}}`]);
    });
    for (const t of ['course_sessions', 'transcript_sessions', 'transcript_segments', 'timeline_markers', 'note_anchors', 'modules']) {
      expect(((await as(B, () => q(`select * from ${t}`))) as { rows: unknown[] }).rows, t).toHaveLength(0);
      expect(((await as(A, () => q(`select * from ${t}`))) as { rows: unknown[] }).rows.length, t).toBeGreaterThan(0);
    }
  });

  it('B ne peut pas écrire une séance, un segment ou un marqueur dans la séance de A', async () => {
    await expect(as(B, () => q(`insert into transcript_segments (id, session_id, start_ms, end_ms, text, provider) values ($1,$2,0,1,'x','y')`, [uuid(40), uuid(20)]))).rejects.toThrow();
    await expect(as(B, () => q(`insert into course_sessions (id, subject_id, type, title, date) values ($1,$2,'CM','x','2026-10-07')`, [uuid(41), uuid(1)]))).rejects.toThrow();
    await expect(as(B, () => q(`insert into timeline_markers (id, session_id, at_ms) values ($1,$2,1)`, [uuid(42), uuid(20)]))).rejects.toThrow();
  });

  it('profils : chacun ne voit et ne modifie que le sien', async () => {
    const a = await as(A, () => q<{ id: string }>('select id from profiles')) as { rows: { id: string }[] };
    expect(a.rows.map((r) => r.id)).toEqual([A]);
    const upd = await as(B, () => q(`update profiles set first_name = 'x' where id = $1`, [A])) as { affectedRows: number };
    expect(upd.affectedRows).toBe(0);
    await as(A, () => q(`update profiles set first_name = 'Léa', onboarding_completed = true where id = $1`, [A]));
    const r = await as(A, () => q<{ first_name: string }>('select first_name from profiles')) as { rows: { first_name: string }[] };
    expect(r.rows[0]?.first_name).toBe('Léa');
  });

  it('un visiteur anonyme (non connecté) ne voit rien et ne peut rien écrire', async () => {
    await expect(as(null, () => q('select * from subjects'))).rejects.toThrow(/permission denied/i);
    await expect(as(null, () => insertSubject(uuid(50), 'anon'))).rejects.toThrow(/permission denied/i);
    await expect(as(null, () => q('select * from profiles'))).rejects.toThrow(/permission denied/i);
  });

  it('versions : le serveur incrémente `version` à chaque mise à jour (détection de conflit)', async () => {
    const v1 = await as(A, () => q<{ version: number }>('select version from subjects where id = $1', [uuid(1)])) as { rows: { version: number }[] };
    await as(A, () => q(`update subjects set name = 'Droit privé' where id = $1`, [uuid(1)]));
    const v2 = await as(A, () => q<{ version: number }>('select version from subjects where id = $1', [uuid(1)])) as { rows: { version: number }[] };
    expect(v2.rows[0]!.version).toBe(v1.rows[0]!.version + 1);
    // mise à jour conditionnelle (verrou optimiste) : 0 ligne si la version de base est périmée
    const stale = await as(A, () => q(`update subjects set name = 'x' where id = $1 and version = $2`, [uuid(1), v1.rows[0]!.version])) as { affectedRows: number };
    expect(stale.affectedRows).toBe(0);
  });

  it('suppression douce : deleted_at est conservé et visible pour la synchronisation de l’autre appareil', async () => {
    await as(A, () => q(`update subjects set deleted_at = now() where id = $1`, [uuid(1)]));
    const r = await as(A, () => q<{ deleted_at: string | null }>('select deleted_at from subjects where id = $1', [uuid(1)])) as { rows: { deleted_at: string | null }[] };
    expect(r.rows[0]?.deleted_at).toBeTruthy();
  });

  it('FORCE ROW LEVEL SECURITY est actif sur toutes les tables de données', async () => {
    const r = await q<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`);
    expect(r.rows.length).toBeGreaterThanOrEqual(11);
    for (const t of r.rows) { expect(t.relrowsecurity, t.relname).toBe(true); expect(t.relforcerowsecurity, t.relname).toBe(true); }
  });
});
