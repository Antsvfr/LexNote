// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.setConfig({ testTimeout: 90_000 });   // chaque test crée un Postgres complet (PGlite) : lent sous charge
import { makeDb } from '../../src/integration/testkit';

/** L'audit de production (scripts/prod/verify-db.sql) doit être VERT sur les deux migrations, et ROUGE quand on dégrade la sécurité. */
const SQL = readFileSync('scripts/prod/verify-db.sql', 'utf8');
describe.each(['lexnote', 'revem'] as const)('verify-db.sql — schéma %s', (kind) => {
  const run = async (mutate?: string) => {
    const db = await makeDb(kind, []);
    if (mutate) await db.exec(mutate);
    const r = await db.query<{ n: number; controle: string; statut: string; detail: string | null }>(SQL);
    return r.rows;
  };
  it('tous les contrôles passent sur la migration livrée', async () => {
    const rows = await run();
    expect(rows.filter((r) => r.statut === 'FAIL').map((r) => r.controle)).toEqual([]);
    expect(rows.at(-1)!.statut).toBe('24 PASS / 0 FAIL');
  });
  it.each([
    ['FORCE RLS retirée', 'alter table public.integration_links no force row level security;', 'FORCE RLS sur les 3 tables'],
    ['droit de lecture donné à authenticated sur les références', 'grant select on public.integration_links to authenticated;', 'authenticated ne peut lire AUCUNE colonne de référence'],
    ['fonction exposée à authenticated', 'grant execute on function public.integration_revoke_link(text, text, text) to authenticated;', 'aucune fonction exécutable par anon / authenticated / PUBLIC'],
    ['search_path détaché', 'alter function public.integration_get_link(text, text) reset search_path;', 'search_path figé (public, pg_temp)'],
    ['policy sans initplan', `drop policy integration_links_select_own on public.integration_links; create policy integration_links_select_own on public.integration_links for select to authenticated using (user_id = auth.uid());`, 'policy de lecture integration_links : (select auth.uid())'],
    ['écriture ouverte', 'grant insert on public.integration_links to authenticated;', 'authenticated : SELECT seulement, sur integration_links'],
  ])('détecte : %s', async (_l, mutation, expected) => {
    const rows = await run(mutation);
    expect(rows.filter((r) => r.statut === 'FAIL').map((r) => r.controle)).toContain(expected);
  });
});
