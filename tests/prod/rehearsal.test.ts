// @vitest-environment node
import { describe, expect, it } from 'vitest';
// @ts-expect-error module .mjs sans types
import { assertLocal, backupRestore, dbRollback } from '../../scripts/prod/rehearsal.mjs';

describe('rehearsal.mjs — garde-fous', () => {
  it('accepte socket Unix et localhost, REFUSE tout hôte distant (Supabase, production)', () => {
    expect(() => assertLocal('postgresql:///postgres?host=/var/tmp/pgsock&port=54329&user=postgres')).not.toThrow();
    expect(() => assertLocal('postgresql://postgres@localhost:5432/postgres')).not.toThrow();
    expect(() => assertLocal('postgresql://postgres:x@127.0.0.1/postgres')).not.toThrow();
    expect(() => assertLocal('postgresql://postgres:x@db.abcdefghijklmnopqrst.supabase.co:5432/postgres')).toThrow(/REFUSÉ/);
    expect(() => assertLocal('postgresql://postgres:x@10.1.2.3/postgres')).toThrow(/REFUSÉ/);
  });
});

/** Répétitions réelles : seulement si un PostgreSQL local est fourni (REHEARSAL_URL). Sinon ignorées — jamais comptées comme réussies. */
const url = process.env.REHEARSAL_URL;
describe.skipIf(!url)('rehearsal.mjs — sur un vrai PostgreSQL local', () => {
  it('sauvegarde → incident → restauration : contenu identique', async () => { expect(await backupRestore(url, () => {})).toBe(0); }, 180_000);
  it('retour arrière du code : base additive, ancien code compatible', async () => { expect(await dbRollback(url, () => {})).toBe(0); }, 180_000);
});
