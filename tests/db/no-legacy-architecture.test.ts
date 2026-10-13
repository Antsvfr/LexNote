// @vitest-environment node
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Garde-fou « une seule architecture » : plus rien dans le code livré ne doit dépendre de l’ancien schéma / moteur de sync / auth de la PR #5 (SUPERSEDED). */
const files = (dirs: string[]) => execSync(`git ls-files ${dirs.join(' ')}`, { encoding: 'utf8' }).split('\n').filter((f) => f && /\.(ts|tsx|mjs|js|sql|json|yml|yaml)$/.test(f));
const EXCLUDE = [/^tests\/db\/fixtures\//, /^tests\/db\/(schema-reconciliation|no-legacy-architecture)\.test\.ts$/, /^supabase\/reconciliation\//];
const scanned = () => files(['src', 'supabase', 'scripts', 'tests', '.github']).filter((f) => !EXCLUDE.some((re) => re.test(f)));

// Colonnes, fonctions, fichiers et modules propres à l’ancien schéma / client Supabase maison de la PR #5.
const LEGACY = [
  /\bsession_number\b/, /\bsession_date\b/, /\bsession_type\b/, /\bcourse_session_id\b/, /\btranscript_session_id\b/, /\bnearby_transcript_segment_ids\b/, /\bmarker_type\b/, /\baudio_metadata\b/,
  /\bpublic\.set_updated_at\b/, /\bpublic\.handle_new_user\b/, /multiuser_core/, /performance_hardening/,
  /services\/supabase\/(client|database\.types)/, /from ['"]@\/services\/sync\/cloud['"]/, /captureCloud/, /services\/migration\/legacy/,
];

describe('une seule architecture : la chaîne #3 → #8', () => {
  it('aucun fichier livré ne référence l’ancien schéma, son client HTTP, son moteur de sync ou ses migrations', () => {
    const hits: string[] = [];
    for (const f of scanned()) {
      const txt = readFileSync(f, 'utf8');
      for (const re of LEGACY) if (re.test(txt)) hits.push(`${f} ~ ${re}`);
    }
    expect(hits).toEqual([]);
  });
  it('les fichiers propres à la PR #5 n’existent pas', () => {
    for (const f of ['src/services/supabase/client.ts', 'src/services/supabase/database.types.ts', 'src/services/sync/cloud.ts', 'src/services/sync/captureCloud.ts', 'src/services/migration/legacy.ts', 'supabase/migrations/001_multiuser_core.sql', 'supabase/migrations/002_performance_hardening.sql'])
      expect(existsSync(f), f).toBe(false);
  });
  it('toutes les tables lues / écrites par le moteur de synchronisation et les fonctions existent dans le schéma officiel', async () => {
    const official = new Set(['profiles', 'subjects', 'modules', 'course_sessions', 'transcript_sessions', 'transcript_segments', 'timeline_markers', 'note_anchors', 'capture_interruptions', 'sync_metadata', 'external_accounts', 'study_artifacts', 'source_documents', 'generated_courses', 'integration_links', 'integration_link_intents', 'integration_nonces']);
    const { VERSIONED_TABLES, CAPTURE_TABLES } = await import('../../src/services/sync/types');
    const used = new Set<string>([...VERSIONED_TABLES, ...CAPTURE_TABLES, 'sync_metadata', 'profiles']);
    for (const f of files(['src', 'supabase/functions']).filter((x) => !/\.test\.|testkit/.test(x))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\.from\(\s*['"]([a-z_]+)['"]\s*\)/g)) used.add(m[1]!);
    }
    expect([...used].filter((t) => !official.has(t))).toEqual([]);
    expect(used.size).toBeGreaterThanOrEqual(10);                                         // le test voit bien les accès (sinon il ne prouve rien)
  });
  it('l’authentification et la synchronisation passent par le seul moteur officiel (supabase-js + SyncEngine)', () => {
    expect(existsSync('src/services/sync/engine.ts') || existsSync('src/services/sync/syncEngine.ts') || existsSync('src/services/sync/SyncEngine.ts')).toBe(true);
    expect(readFileSync('src/services/backend/index.ts', 'utf8')).toContain("from '@supabase/supabase-js'");
  });
});
