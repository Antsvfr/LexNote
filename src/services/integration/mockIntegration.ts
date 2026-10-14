/**
 * Intégration SIMULÉE — uniquement dans le build de test (`VITE_BACKEND=mock`) : permet de tester l'interface sans second projet.
 * La sécurité réelle (signatures, rejeu, RLS, intentions) est testée sur le vrai code (src/integration/*.test.ts, tests/db).
 */
import type { ConnectionState } from '@/integration/contracts';
import { INTEGRATION_VERSION } from '@/integration/version';
import type { IntegrationApi } from './types';

const KEY = 'lexnote-mock-integration';
const read = (): Record<string, { linkId: string; status: 'CONNECTED' | 'REVOKED'; linkedAt: string; revokedAt?: string; autoLogin?: boolean }> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
const write = (v: ReturnType<typeof read>) => localStorage.setItem(KEY, JSON.stringify(v));

export function createMockIntegration(getUserId: () => string | null): IntegrationApi {
  const state = (): ConnectionState => {
    const uid = getUserId() ?? ''; const l = read()[uid]; const now = new Date().toISOString();
    const base = { integrationVersion: INTEGRATION_VERSION, kind: 'connection-state' as const, partner: 'revem' as const, checkedAt: now };
    if (!l) return { ...base, state: 'NOT_CONNECTED', localStatus: null, peerStatus: 'UNKNOWN', verified: false };
    if (l.status === 'REVOKED') return { ...base, state: 'REVOKED', linkId: l.linkId, localStatus: 'REVOKED', peerStatus: 'UNKNOWN', verified: false, linkedAt: l.linkedAt, revokedAt: l.revokedAt, revokedBy: 'self' };
    return { ...base, state: 'CONNECTED', linkId: l.linkId, localStatus: 'CONNECTED', peerStatus: 'CONNECTED', verified: true, linkedAt: l.linkedAt, autoLogin: l.autoLogin === true };
  };
  const fail = (code: string, message: string) => ({ ok: false as const, error: { code, message, retryable: false } });
  return {
    async call(action, body = {}) {
      const intent = String(body.linkIntentId ?? body.launchIntentId ?? ''); const nonce = String(body.nonce ?? '');
      // Propriétaire d'un lancement simulé : posé par le test (`lexnote-mock-launch-owner:<intent>`), comme REV-EM le saurait via la liaison.
      const owner = localStorage.getItem(`lexnote-mock-launch-owner:${intent}`);
      const usedKey = `lexnote-mock-launch-used:${intent}`;
      if (action === 'launch-signin') {
        // SIMULATION de la connexion automatique (la vraie vérification : launch.test.ts / integration tests, serveur réel).
        if (localStorage.getItem('lexnote-mock-peer-auth-failed') === '1') return { ok: false as const, error: { code: 'PEER_AUTH_FAILED', message: 'Passerelle REV-EM protégée par JWT.', retryable: false, details: { reason: 'gateway-verify-jwt' } } };
        if (intent.startsWith('00000000')) return fail('LINK_EXPIRED', 'Demande expirée.');
        if (localStorage.getItem(usedKey)) return fail('GONE', 'Demande déjà utilisée.');
        if (nonce.startsWith('x') || !owner) return fail('FORBIDDEN', 'Code invalide.');
        const l = read()[owner];
        if (!l || l.status !== 'CONNECTED') return fail('LINK_REVOKED', 'Liaison non active.');
        if (!l.autoLogin) return fail('AUTO_LOGIN_DISABLED', 'Connexion automatique non autorisée.');
        return { ok: true, session: { access_token: `mock-sso:${owner}`, refresh_token: 'mock-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer' as const } };
      }
      // Simulations (tests) : session LexNote révoquée côté serveur, et partenaire refusant l'authentification de NOTRE serveur.
      if (localStorage.getItem('lexnote-mock-session-revoked') === '1') return { ok: false as const, error: { code: 'SESSION_REQUIRED', message: 'Session révoquée.', retryable: false } };
      if (localStorage.getItem('lexnote-mock-peer-auth-failed') === '1' && action !== 'status') return { ok: false as const, error: { code: 'PEER_AUTH_FAILED', message: 'Passerelle REV-EM protégée par JWT.', retryable: false, details: { reason: 'gateway-verify-jwt' } } };
      const uid = getUserId(); if (!uid) return fail('UNAUTHENTICATED', 'Jeton absent.');
      if (action === 'inspect' || action === 'confirm') {
        if (intent.startsWith('00000000')) return fail('LINK_EXPIRED', 'Demande expirée.');
        if (intent.startsWith('11111111')) return fail('GONE', 'Demande déjà utilisée.');
        if (nonce.startsWith('x')) return fail('FORBIDDEN', 'Code invalide.');
        if (action === 'inspect') return { ok: true, displayHint: 'Alice', expiresAt: new Date(Date.now() + 240_000).toISOString() };
        if (read()[uid]?.status === 'CONNECTED') return fail('CONFLICT', 'Un compte est déjà lié.');
        const all = read(); all[uid] = { linkId: `lnk_${crypto.randomUUID().replace(/-/g, '')}`, status: 'CONNECTED', linkedAt: new Date().toISOString(), autoLogin: body.autoLogin === true }; write(all);
        return { ok: true, state: state(), returnUrl: 'http://localhost:8080/?lexnote_link=connected' };
      }
      if (action === 'auto-login') {
        const all = read(); const l = all[uid];
        if (!l || l.status !== 'CONNECTED') return fail('LINK_NOT_FOUND', 'Aucune liaison active.');
        l.autoLogin = body.enabled === true; write(all);
        return { ok: true, state: state() };
      }
      if (action === 'launch-open') {
        if (owner && owner !== uid) return fail('WRONG_ACCOUNT', 'Ce cours est lié à un autre compte LexNote.');
        if (localStorage.getItem(usedKey)) return fail('GONE', 'Demande déjà utilisée.');
        // SIMULATION (build de test) : la vraie garantie d'idempotence est en base (tests/db + src/integration/launch.test.ts). Ici : parcours d'interface.
        if (read()[uid]?.status !== 'CONNECTED') return fail('LINK_NOT_FOUND', 'REV-EM n’est pas connecté.');
        if (intent.startsWith('00000000')) return fail('LINK_EXPIRED', 'Demande expirée.');
        if (intent.startsWith('11111111')) return fail('GONE', 'Demande déjà utilisée.');
        if (nonce.startsWith('x')) return fail('FORBIDDEN', 'Code invalide.');
        const ev = (() => { try { return JSON.parse(localStorage.getItem(`lexnote-mock-launch-event:${intent}`) ?? 'null'); } catch { return null; } })()
          ?? { externalId: 'evt_default', subjectRef: 'subj_dc', subjectName: 'Droit des contrats', type: 'CM', title: 'Formation du contrat', date: '2026-10-09', startTime: '08:00', endTime: '10:00', room: 'A204', teacher: 'Mme Dupont' };
        const { useLibrary } = await import('@/store/library');
        const lib = useLibrary.getState();
        const refs = JSON.parse(localStorage.getItem('lexnote-mock-launch-refs') ?? '{"s":{},"e":{}}') as { s: Record<string, string>; e: Record<string, string> };
        const sk = `${uid}:${ev.subjectRef}`; const ek = `${uid}:${ev.externalId}`;
        let created = false;
        let session = refs.e[ek] ? lib.sessions.find((x) => x.id === refs.e[ek]) : undefined;
        if (!session) {
          let subject = refs.s[sk] ? lib.subjects.find((x) => x.id === refs.s[sk]) : undefined;
          if (!subject) subject = lib.subjects.find((x) => x.name.trim().toLowerCase() === String(ev.subjectName).trim().toLowerCase());
          if (!subject) subject = await lib.addSubject({ name: ev.subjectName });
          refs.s[sk] = subject.id;
          session = await lib.addSession({ subjectId: subject.id, type: ev.type, title: ev.title, date: ev.date, startTime: ev.startTime, endTime: ev.endTime, teacher: ev.teacher, room: ev.room });
          refs.e[ek] = session.id; created = true;
          localStorage.setItem('lexnote-mock-launch-refs', JSON.stringify(refs));
        }
        if (owner) localStorage.setItem(usedKey, '1');      // lancements des tests de connexion automatique : usage unique simulé
        return { ok: true, sessionId: session.id, subjectId: session.subjectId, createdSession: created };
      }
      if (action === 'revoke') { const all = read(); const l = all[uid]; if (l) { l.status = 'REVOKED'; l.revokedAt = new Date().toISOString(); l.autoLogin = false; write(all); } return { ok: true, state: state(), peerNotified: true }; }
      return { ok: true, state: state() };
    },
  };
}
