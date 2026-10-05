import { describe, expect, it } from 'vitest';
import { isTrusted, mustBeFlagged, resolveInitialVerification } from './legal';

describe('fiabilité juridique', () => {
  it('une information produite par l’IA ne peut jamais être créée "Verified"', () => {
    expect(resolveInitialVerification('AI', 'VERIFIED')).toBe('UNVERIFIED');
    expect(resolveInitialVerification('UNKNOWN', 'VERIFIED')).toBe('UNVERIFIED');
  });
  it('une source vérifiée peut être "Verified"', () => {
    expect(resolveInitialVerification('VERIFIED_SOURCE', 'VERIFIED')).toBe('VERIFIED');
  });
  it('par défaut tout est "Unverified"', () => expect(resolveInitialVerification('PROFESSOR')).toBe('UNVERIFIED'));
  it('l’IA n’est jamais "fiable" à elle seule et doit toujours être signalée', () => {
    expect(isTrusted({ provenance: 'AI', verification: 'VERIFIED' })).toBe(false);
    expect(mustBeFlagged({ provenance: 'AI', verification: 'VERIFIED' })).toBe(true);
    expect(isTrusted({ provenance: 'VERIFIED_SOURCE', verification: 'VERIFIED' })).toBe(true);
  });
});
