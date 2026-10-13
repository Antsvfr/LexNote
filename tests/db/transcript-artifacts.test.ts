// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { artifactFromRow, artifactToRow } from '@/services/sync/mappers';
import type { StudyArtifact } from '@/domain/study';

/**
 * Migration 20261015 (documents dérivés de la transcription + profil d'études) sur un vrai Postgres (PGlite) :
 * chaîne COMPLÈTE des migrations du dépôt, RLS inchangée, contraintes, rétrocompatibilité et rejouabilité.
 */
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db: PGlite;
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params);
async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
const MIGRATIONS = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
const MIG = '20261015000000_transcript_derived_artifacts.sql';
const strip = (sql: string) => sql.replace(/create extension[^;]*;/gi, '');

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  for (const f of MIGRATIONS) {
    if (f === MIG) {
      // données ANTÉRIEURES à la migration : un support du cours reconstruit doit survivre tel quel
      await db.exec(`insert into auth.users values ('${A}', 'a@test.fr'), ('${B}', 'b@test.fr');`);
      await as(A, () => q(`insert into study_artifacts (id, type, title, content, course_id, generation) values ($1, 'COURSE_SHEET', 'Fiche', '{"mode":"standard","sections":[]}', $2, 1)`, [uuid(1), uuid(2)]));
    }
    await db.exec(strip(readFileSync(`supabase/migrations/${f}`, 'utf8')));
  }
});

const insertDoc = (id: string, extra: Record<string, unknown> = {}) => {
  const cols = { id, type: 'SUMMARY', title: 'Résumé', content: '{"language":"fr","blocks":[]}', source_type: 'transcript', source_session_id: uuid(50), language: 'fr', generation_type: 'summarize', generator: '{"providerId":"remote:anthropic","model":"m","local":false}', ...extra };
  const keys = Object.keys(cols);
  return q(`insert into study_artifacts (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
};

describe('migration 20261015 — documents dérivés de la transcription', () => {
  it('chaîne complète appliquée ; données antérieures intactes (source_type par défaut, revisions vides)', async () => {
    expect(MIGRATIONS).toContain(MIG);
    const r = await as(A, () => q<{ type: string; source_type: string; revisions: unknown[] }>('select type, source_type, revisions from study_artifacts where id = $1', [uuid(1)]));
    expect(r.rows[0]).toEqual({ type: 'COURSE_SHEET', source_type: 'reconstructed-course', revisions: [] });
  });
  it('rejouable sans erreur (idempotente)', async () => {
    await expect(db.exec(readFileSync(`supabase/migrations/${MIG}`, 'utf8'))).resolves.toBeDefined();
  });
  it('nouveaux types acceptés ; type inconnu refusé', async () => {
    for (const [k, t] of ['SUMMARY', 'TRANSLATION', 'CLEAN_TRANSCRIPT', 'STRUCTURED_NOTES', 'KEY_POINTS', 'GLOSSARY', 'EXAM_QUESTIONS', 'STUDY_NOTE'].entries()) {
      await as(A, () => insertDoc(uuid(100 + k), { type: t }));
    }
    await expect(as(A, () => insertDoc(uuid(120), { type: 'FAKE_TYPE' }))).rejects.toThrow();
  });
  it('un document dérivé de la transcription porte toujours sa séance ; source_type borné ; revisions = tableau', async () => {
    await expect(as(A, () => insertDoc(uuid(121), { source_session_id: null }))).rejects.toThrow();
    await expect(as(A, () => insertDoc(uuid(122), { source_type: 'internet' }))).rejects.toThrow();
    await expect(as(A, () => insertDoc(uuid(123), { revisions: '{"a":1}' }))).rejects.toThrow();
    await expect(as(A, () => insertDoc(uuid(124), { language: 'x' }))).rejects.toThrow();
  });
  it('RLS inchangée : B ne lit, ne modifie, ne supprime pas les documents de A ; anon bloqué ; usurpation refusée', async () => {
    await as(A, () => insertDoc(uuid(130)));
    expect((await as(B, () => q('select id from study_artifacts where id = $1', [uuid(130)]))).rows).toHaveLength(0);
    expect((await as(B, () => q(`update study_artifacts set title = 'x' where id = $1`, [uuid(130)]))).affectedRows).toBe(0);
    expect((await as(B, () => q('delete from study_artifacts where id = $1', [uuid(130)]))).affectedRows).toBe(0);
    await expect(as(null, () => q('select * from study_artifacts'))).rejects.toThrow();
    await expect(as(B, () => insertDoc(uuid(131), { user_id: A }))).rejects.toThrow();
  });
  it('profil : domaine d’études et usage principal facultatifs, bornés, isolés par la RLS', async () => {
    await as(A, () => q(`update profiles set field_of_study = 'École de commerce', primary_use = 'transcribe' where id = $1`, [A]));
    expect((await as(A, () => q<{ field_of_study: string }>('select field_of_study from profiles where id = $1', [A]))).rows[0]?.field_of_study).toBe('École de commerce');
    expect((await as(B, () => q('select field_of_study from profiles where id = $1', [A]))).rows).toHaveLength(0);
    await expect(as(A, () => q(`update profiles set field_of_study = $1 where id = $2`, ['x'.repeat(81), A]))).rejects.toThrow();
  });
  it('aller-retour avec le mappeur de synchronisation (colonnes envoyées seulement pour un document dérivé)', async () => {
    const art = {
      id: uuid(140), userId: A, type: 'TRANSLATION', title: 'Traduction', subjectId: null, sourceSessionIds: [uuid(50)], scope: null, settings: {},
      content: { language: 'es', blocks: [{ id: 'b1', kind: 'paragraph', text: 'hola' }] }, generatedContent: null, courseId: '', courseVersion: 0,
      sourceSnapshot: { sources: [], hash: '' }, engineVersion: 'm', provenance: { from: 'transcript' }, generation: 2, userEdited: true,
      sourceType: 'transcript', generationType: 'translate', language: 'es', sourceTranscriptVersion: 't3-abc', parentArtifactId: null,
      generator: { providerId: 'remote:anthropic', model: 'm', local: false }, revisions: [{ generation: 1, title: 'v1', content: {}, userEdited: true, savedAt: '2026-10-13T00:00:00Z' }],
      createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z',
    } as unknown as StudyArtifact;
    const row = artifactToRow(art);
    const { deleted_at: _d, ...cols } = row as Record<string, unknown>;
    const keys = Object.keys(cols).filter((k) => k !== 'created_at' && k !== 'updated_at');
    await as(A, () => q(`insert into study_artifacts (${keys.join(', ')}) values (${keys.map((k, i) => (typeof cols[k] === 'object' && cols[k] !== null ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')})`,
      keys.map((k) => (typeof cols[k] === 'object' && cols[k] !== null ? JSON.stringify(cols[k]) : cols[k]))));
    const back = artifactFromRow((await as(A, () => q('select * from study_artifacts where id = $1', [uuid(140)]))).rows[0] as never);
    expect(back).toMatchObject({ sourceType: 'transcript', generationType: 'translate', language: 'es', sourceTranscriptVersion: 't3-abc', courseId: '', revisions: [{ generation: 1 }] });
    // un support du cours reconstruit n'envoie AUCUNE nouvelle colonne (compatible avec une base pas encore migrée)
    const legacy = artifactToRow({ ...art, sourceType: undefined, revisions: [] } as StudyArtifact);
    for (const k of ['source_type', 'source_session_id', 'language', 'generation_type', 'generator', 'parent_artifact_id', 'revisions']) expect(legacy).not.toHaveProperty(k);
  });
});
