/**
 * Intégration SIMULÉE — uniquement dans le build de test (`VITE_BACKEND=mock`) : permet de tester l'interface sans second projet.
 * La sécurité réelle (signatures, rejeu, RLS, intentions) est testée sur le vrai code (src/integration/*.test.ts, tests/db).
 */
import type { ConnectionState } from '@/integration/contracts';
import { INTEGRATION_VERSION } from '@/integration/version';
import type { IntegrationApi } from './types';

const KEY = 'lexnote-mock-integration';
const read = (): Record<string, { linkId: string; status: 'CONNECTED' | 'REVOKED'; linkedAt: string; revokedAt?: string }> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
const write = (v: ReturnType<typeof read>) => localStorage.setItem(KEY, JSON.stringify(v));

export function createMockIntegration(getUserId: () => string | null): IntegrationApi {
  const state = (): ConnectionState => {
    const uid = getUserId() ?? ''; const l = read()[uid]; const now = new Date().toISOString();
    const base = { integrationVersion: INTEGRATION_VERSION, kind: 'connection-state' as const, partner: 'revem' as const, checkedAt: now };
    if (!l) return { ...base, state: 'NOT_CONNECTED', localStatus: null, peerStatus: 'UNKNOWN', verified: false };
    if (l.status === 'REVOKED') return { ...base, state: 'REVOKED', linkId: l.linkId, localStatus: 'REVOKED', peerStatus: 'UNKNOWN', verified: false, linkedAt: l.linkedAt, revokedAt: l.revokedAt, revokedBy: 'self' };
    return { ...base, state: 'CONNECTED', linkId: l.linkId, localStatus: 'CONNECTED', peerStatus: 'CONNECTED', verified: true, linkedAt: l.linkedAt };
  };
  const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message, retryable: false } });
  return {
    async call(action, body = {}) {
      const uid = getUserId(); if (!uid) return fail('UNAUTHENTICATED', 'Jeton absent.');
      const intent = String(body.linkIntentId ?? ''); const nonce = String(body.nonce ?? '');
      if (action === 'inspect' || action === 'confirm') {
        if (intent.startsWith('00000000')) return fail('LINK_EXPIRED', 'Demande expirée.');
        if (intent.startsWith('11111111')) return fail('GONE', 'Demande déjà utilisée.');
        if (nonce.startsWith('x')) return fail('FORBIDDEN', 'Code invalide.');
        if (action === 'inspect') return { ok: true, displayHint: 'Alice', expiresAt: new Date(Date.now() + 240_000).toISOString() };
        if (read()[uid]?.status === 'CONNECTED') return fail('CONFLICT', 'Un compte est déjà lié.');
        const all = read(); all[uid] = { linkId: `lnk_${crypto.randomUUID().replace(/-/g, '')}`, status: 'CONNECTED', linkedAt: new Date().toISOString() }; write(all);
        return { ok: true, state: state(), returnUrl: 'http://localhost:8080/?lexnote_link=connected' };
      }
      if (action === 'revoke') { const all = read(); const l = all[uid]; if (l) { l.status = 'REVOKED'; l.revokedAt = new Date().toISOString(); write(all); } return { ok: true, state: state(), peerNotified: true }; }
      return { ok: true, state: state() };
    },
  };
}
