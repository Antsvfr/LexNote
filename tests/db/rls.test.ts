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
  await db.exec(readFileSync('supabase/migrations/20261008000000_study_artifacts.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009000000_course_engine.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261010000000_study_artifacts_from_course.sql', 'utf8'));
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

describe('Row Level Security — supports d\'étude', () => {
  const art = (id: string, extra = '') => q(`insert into study_artifacts (id, type, title, content${extra}) values ($1, 'MIND_MAP', 'Carte', '{}'::jsonb)`, [id]);
  it('chacun ne voit, ne modifie et ne supprime que ses supports', async () => {
    await as(A, () => art(uuid(900)));
    await as(B, () => art(uuid(901)));
    expect((await as(A, () => q('select id from study_artifacts'))) as { rows: unknown[] }).toMatchObject({ rows: [{ id: uuid(900) }] });
    const upd = (await as(B, () => q(`update study_artifacts set title = 'piraté' where id = $1`, [uuid(900)]))) as { affectedRows: number };
    expect(upd.affectedRows).toBe(0);
    const del = (await as(B, () => q('delete from study_artifacts where id = $1', [uuid(900)]))) as { affectedRows: number };
    expect(del.affectedRows).toBe(0);
  });
  it('usurpation de user_id refusée ; anon bloqué ; type inconnu refusé (METHOD accepté)', async () => {
    await expect(as(B, () => q(`insert into study_artifacts (id, user_id, type, title, content) values ($1, $2, 'QUIZ', 'x', '{}')`, [uuid(902), A]))).rejects.toThrow();
    await expect(as(null, () => q('select * from study_artifacts'))).rejects.toThrow();
    await expect(as(A, () => q(`insert into study_artifacts (id, type, title, content) values ($1, 'AUTRE', 'x', '{}')`, [uuid(903)]))).rejects.toThrow();
    await as(A, () => q(`insert into study_artifacts (id, type, title, content, course_id, generation) values ($1, 'METHOD', 'Méthode', '{}', $2, 2)`, [uuid(905), uuid(906)]));
    expect(((await as(B, () => q('select id from study_artifacts where id = $1', [uuid(905)]))) as { rows: unknown[] }).rows).toHaveLength(0);
  });
  it('un support ne peut pas être rattaché à la matière d\'un autre utilisateur', async () => {
    await as(A, () => insertSubject(uuid(910), 'Matière de A'));
    await expect(as(B, () => q(`insert into study_artifacts (id, type, title, content, subject_id) values ($1, 'QUIZ', 'x', '{}', $2)`, [uuid(904), uuid(910)]))).rejects.toThrow();
  });
});

describe('Row Level Security — moteur de cours (documents, cours reconstruits)', () => {
  const session = (id: string) => q(`insert into course_sessions (id, subject_id, type, title, date) values ($1, $2, 'CM', 't', '2026-01-01')`, [id, uuid(950)]);
  const doc = (id: string, sid: string) => q(`insert into source_documents (id, session_id, name) values ($1, $2, 'cours.pdf')`, [id, sid]);
  const course = (id: string, sid: string, v = 1) => q(`insert into generated_courses (id, session_id, course_version, generated_at, source_snapshot, content) values ($1, $2, $3, now(), '{}', '{}')`, [id, sid, v]);
  beforeAll(async () => {
    await as(A, async () => { await insertSubject(uuid(950), 'Matière A2'); await session(uuid(951)); });
    await as(B, async () => { await insertSubject(uuid(952), 'Matière B2'); await q(`insert into course_sessions (id, subject_id, type, title, date) values ($1, $2, 'CM', 't', '2026-01-01')`, [uuid(953), uuid(952)]); });
  });
  it('isolation des documents et des cours (lecture, modification, suppression)', async () => {
    await as(A, async () => { await doc(uuid(960), uuid(951)); await course(uuid(961), uuid(951)); });
    expect(((await as(B, () => q('select id from source_documents'))) as { rows: unknown[] }).rows).toHaveLength(0);
    expect(((await as(B, () => q('select id from generated_courses'))) as { rows: unknown[] }).rows).toHaveLength(0);
    expect(((await as(B, () => q(`update source_documents set name = 'x' where id = $1`, [uuid(960)]))) as { affectedRows: number }).affectedRows).toBe(0);
    expect(((await as(B, () => q('delete from generated_courses where id = $1', [uuid(961)]))) as { affectedRows: number }).affectedRows).toBe(0);
  });
  it('B ne peut pas rattacher un document ou un cours à la séance de A ; anon bloqué', async () => {
    await expect(as(B, () => doc(uuid(962), uuid(951)))).rejects.toThrow();
    await expect(as(B, () => course(uuid(963), uuid(951)))).rejects.toThrow();
    await expect(as(null, () => q('select * from source_documents'))).rejects.toThrow();
    await expect(as(null, () => q('select * from generated_courses'))).rejects.toThrow();
  });
  it('plusieurs versions d’un cours coexistent (aucune écrasée) ; statut invalide refusé', async () => {
    await as(A, async () => { await course(uuid(964), uuid(951), 2); await course(uuid(965), uuid(951), 3); });
    expect(((await as(A, () => q('select course_version from generated_courses order by course_version'))) as { rows: { course_version: number }[] }).rows.map((r) => r.course_version)).toEqual([1, 2, 3]);
    await expect(as(A, () => q(`insert into source_documents (id, session_id, name, status) values ($1, $2, 'x', 'bizarre')`, [uuid(966), uuid(951)]))).rejects.toThrow();
  });
});
