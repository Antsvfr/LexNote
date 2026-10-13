// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REVEM_LAUNCH_FIXTURE, REVEM_LAUNCH_REPO_SQL } from './testkit';

/** La copie versionnée de la migration REV-EM (tests sans dépôt voisin, CI) doit rester identique à l'original. */
describe('copie de la migration REV-EM 008_integration_launch.sql', () => {
  it('existe dans le dépôt', () => { expect(existsSync(REVEM_LAUNCH_FIXTURE)).toBe(true); });
  it.runIf(existsSync(REVEM_LAUNCH_REPO_SQL))('identique au fichier du dépôt REV-EM', () => {
    expect(readFileSync(REVEM_LAUNCH_FIXTURE, 'utf8')).toBe(readFileSync(REVEM_LAUNCH_REPO_SQL, 'utf8'));
  });
});
