// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error module .mjs sans types
import { assertIntegrationTargets, isLocalMode } from '../../scripts/prod/lib/targets.mjs';
// @ts-expect-error module .mjs sans types
import { diagnose } from '../../scripts/prod/integration-diagnostic.mjs';
// @ts-expect-error module .mjs sans types
import { run as realE2e } from '../../scripts/prod/real-e2e.mjs';

const HOSTED_L = 'https://abcdefghijklmnopqrst.supabase.co'; const HOSTED_R = 'https://tsrqponmlkjihgfedcba.supabase.co';
const LOCAL = { INTEGRATION_LOCAL: '1' };

describe('cibles des scripts d’intégration — mode hébergé (défaut)', () => {
  it('accepte deux projets https://<réf>.supabase.co', () => expect(assertIntegrationTargets({}, { L: HOSTED_L, R: HOSTED_R })).toEqual({ local: false }));
  it.each([
    ['adresse locale (faute de frappe pour un test local)', 'http://127.0.0.1:54321', /INTEGRATION_LOCAL=1/],
    ['localhost', 'http://localhost:54321', /INTEGRATION_LOCAL=1/],
    ['hôte quelconque', 'https://exemple.fr', /supabase\.co/],
    ['http non sécurisé', 'http://abcdefghijklmnopqrst.supabase.co', /supabase\.co/],
    ['domaine ressemblant', 'https://abcdefghijklmnopqrst.supabase.co.evil.io', /supabase\.co/],
    ['référence trop courte', 'https://abc.supabase.co', /supabase\.co/],
  ])('refuse : %s', (_n, url, re) => expect(() => assertIntegrationTargets({}, { L: url })).toThrow(re));
});

describe('cibles — mode LOCAL explicite (INTEGRATION_LOCAL=1)', () => {
  it('accepte deux piles locales sur deux ports', () => {
    expect(isLocalMode(LOCAL)).toBe(true);
    expect(assertIntegrationTargets(LOCAL, { L: 'http://127.0.0.1:54321', R: 'http://localhost:55321' })).toEqual({ local: true });
    expect(assertIntegrationTargets(LOCAL, { L: 'http://[::1]:54321', R: 'http://127.0.0.1:55321' })).toEqual({ local: true });
  });
  it.each([
    ['projet hébergé', HOSTED_L, /jamais un hôte distant/],
    ['hôte distant en http', 'http://10.0.0.5:54321', /jamais un hôte distant/],
    ['nom d’hôte trompeur', 'http://localhost.evil.example:54321', /jamais un hôte distant/],
    ['sous-domaine de localhost', 'http://evil.localhost:54321', /jamais un hôte distant/],
    ['https local', 'https://127.0.0.1:54321', /jamais un hôte distant/],
    ['identifiants dans l’URL', 'http://user:pw@127.0.0.1:54321', /jamais un hôte distant/],
    ['sans port', 'http://127.0.0.1', /jamais un hôte distant/],
  ])('REFUSE : %s — le mode local ne contourne aucune protection', (_n, url, re) => {
    expect(() => assertIntegrationTargets(LOCAL, { L: 'http://127.0.0.1:54321', R: url })).toThrow(re);
  });
  it('refuse deux projets sur le MÊME port (ce ne seraient pas deux piles indépendantes)', () => {
    expect(() => assertIntegrationTargets(LOCAL, { L: 'http://127.0.0.1:54321', R: 'http://localhost:54321' })).toThrow(/ports différents/);
  });
  it('refuse INTEGRATION_ENV=production en mode local', () => {
    expect(() => assertIntegrationTargets({ ...LOCAL, INTEGRATION_ENV: 'production' }, { L: 'http://127.0.0.1:1111', R: 'http://127.0.0.1:2222' })).toThrow(/development/);
  });
  it('INTEGRATION_LOCAL doit valoir exactement « 1 »', () => {
    for (const v of ['true', 'yes', '0', '']) expect(isLocalMode({ INTEGRATION_LOCAL: v })).toBe(false);
  });
});

describe('les scripts appliquent les garde-fous AVANT tout appel réseau', () => {
  const key = 'k'.repeat(48);
  it('integration-diagnostic : mode local + projet distant → FAIL INT-TARGET, zéro requête', async () => {
    const f = vi.fn();
    const r = await diagnose({ INTEGRATION_KEY: key, INTEGRATION_LOCAL: '1', LEXNOTE_SUPABASE_URL: HOSTED_L, REVEM_SUPABASE_URL: 'http://127.0.0.1:55321', LEXNOTE_ORIGIN: 'http://localhost:5173', REVEM_ORIGIN: 'http://localhost:8080' }, { fetchImpl: f });
    expect(r).toEqual([expect.objectContaining({ level: 'FAIL', id: 'INT-TARGET' })]);
    expect(f).not.toHaveBeenCalled();
  });
  it('integration-diagnostic : mode hébergé + adresse locale → FAIL INT-TARGET, zéro requête', async () => {
    const f = vi.fn();
    const r = await diagnose({ INTEGRATION_KEY: key, LEXNOTE_SUPABASE_URL: 'http://127.0.0.1:54321' }, { fetchImpl: f });
    expect(r.map((x: { id: string }) => x.id)).toEqual(['INT-TARGET']);
    expect(f).not.toHaveBeenCalled();
  });
  it('integration-diagnostic : mode local sans origines explicites → refusé (pas de repli sur les origines officielles)', async () => {
    const f = vi.fn();
    const r = await diagnose({ INTEGRATION_KEY: key, INTEGRATION_LOCAL: '1', LEXNOTE_SUPABASE_URL: 'http://127.0.0.1:54321', REVEM_SUPABASE_URL: 'http://127.0.0.1:55321' }, { fetchImpl: f });
    expect(r[0]).toMatchObject({ level: 'FAIL', id: 'INT-TARGET' });
    expect(f).not.toHaveBeenCalled();
  });
  it('real-e2e : mode local + projet distant → exception, zéro requête', async () => {
    const f = vi.fn();
    const base = { INTEGRATION_KEY: key, INTEGRATION_LOCAL: '1', LEXNOTE_ANON_KEY: 'a', REVEM_ANON_KEY: 'a', LEXNOTE_ORIGIN: 'http://localhost:5173', REVEM_ORIGIN: 'http://localhost:8080', REVEM_APP_URL: 'http://localhost:8080/REV-EM/' };
    await expect(realE2e({ ...base, LEXNOTE_SUPABASE_URL: HOSTED_L, REVEM_SUPABASE_URL: 'http://127.0.0.1:55321' }, { log: () => {}, fetchImpl: f })).rejects.toThrow(/hôte distant/);
    await expect(realE2e({ ...base, LEXNOTE_SUPABASE_URL: 'http://127.0.0.1:54321', REVEM_SUPABASE_URL: 'http://127.0.0.1:54321' }, { log: () => {}, fetchImpl: f })).rejects.toThrow(/ports différents/);
    await expect(realE2e({ ...base, REVEM_APP_URL: '', LEXNOTE_SUPABASE_URL: 'http://127.0.0.1:54321', REVEM_SUPABASE_URL: 'http://127.0.0.1:55321' }, { log: () => {}, fetchImpl: f })).rejects.toThrow(/obligatoires/);
    expect(f).not.toHaveBeenCalled();
  });
  it('real-e2e : mode hébergé + adresse locale → exception, zéro requête', async () => {
    const f = vi.fn();
    await expect(realE2e({ INTEGRATION_KEY: key, LEXNOTE_SUPABASE_URL: 'http://127.0.0.1:54321', REVEM_SUPABASE_URL: HOSTED_R, LEXNOTE_ANON_KEY: 'a', REVEM_ANON_KEY: 'a' }, { log: () => {}, fetchImpl: f })).rejects.toThrow(/INTEGRATION_LOCAL=1/);
    expect(f).not.toHaveBeenCalled();
  });
});
