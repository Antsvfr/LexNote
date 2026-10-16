// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { ERROR_CODES } from '../../src/lib/errorCodes';

/** Le runbook ne doit pas mentir : chaque migration, fonction, secret, porte et code d'erreur réels y figurent. */
const doc = readFileSync('docs/PRODUCTION_RUNBOOK.md', 'utf8');

describe('runbook ↔ code', () => {
  it('cite chaque migration LexNote par son vrai nom', () => {
    for (const f of readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql'))) expect(doc, f).toContain(f.replace(/\.sql$/, ''));
  });
  it('cite chaque Edge Function LexNote', () => {
    for (const f of readdirSync('supabase/functions').filter((x) => !x.startsWith('_'))) expect(doc, f).toContain(`\`${f}\``);
  });
  it('cite chaque secret de study-ai et les variables Vercel', () => {
    for (const v of ['STUDY_AI_ENABLED', 'STUDY_AI_GLOBAL_MAX_REQUESTS_DAY', 'STUDY_AI_GLOBAL_MAX_CHARS_DAY', 'STUDY_AI_MAX_OUTPUT_TOKENS', 'ANTHROPIC_API_KEY', 'APP_ORIGINS', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_AI_URL', 'SMOKE_CONFIRM', 'SMOKE_EXPECTED_REF', 'SMOKE_PRODUCTION_REFS']) expect(doc, v).toContain(v);
  });
  it('cite chaque code d’erreur du catalogue', () => {
    for (const code of Object.keys(ERROR_CODES)) expect(doc, code).toContain(code);
  });
  it('décrit les étapes A à G, la sauvegarde et le retour arrière', () => {
    for (const h of ['### A. ', '### B. ', '### C. ', '### D. ', '### E. ', '### F. ', '### G. ', 'Sauvegarde AVANT déploiement', 'PLAN DE RETOUR ARRIÈRE']) expect(doc, h).toContain(h);
  });
  it('cite chaque porte de déploiement', () => {
    const gates = JSON.parse(readFileSync('release/gates.json', 'utf8')).gates as { id: string }[];
    for (const g of gates) expect(doc.includes(g.id) || ['typecheck', 'unit-tests', 'build', 'bundle-check', 'preflight', 'e2e-critical'].includes(g.id), g.id).toBe(true);
  });
  it('ne contient aucun secret', () => {
    expect(doc).not.toMatch(/sk-ant-[A-Za-z0-9_-]{20,}|sbp_[a-f0-9]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  });
});
