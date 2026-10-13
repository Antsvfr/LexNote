/**
 * Ouverture d'un cours REV-EM dans LexNote — « Prendre mes notes dans LexNote » (extension de `lexnote-revem/v1`, aucune architecture parallèle).
 *
 *   REV-EM (initiateur)                                   LexNote (répondant)
 *   startLaunch ─ vérifie la liaison (sonde signée), établit le cours depuis SES données,
 *                 fige une intention (≤ 5 min, usage unique) ─▶ URL  /integrations/revem/launch?intent=<uuid>#n=<nonce>
 *                                                         openLaunch ─▶ REDEEM_LAUNCH (signé) ─▶ [REV-EM] consomme l'intention, renvoie le cours
 *                                                                    ─▶ openCourse (RPC) : matière + séance, IDEMPOTENTES (contraintes UNIQUE en base)
 *                                                                    ─▶ { sessionId } → le navigateur ouvre /session/<id>?panel=transcript
 *
 * Sécurité : le navigateur ne transmet jamais le cours (seulement un identifiant d'événement à REV-EM, puis intention + nonce à LexNote) ;
 * le cours vient du serveur de REV-EM (`LaunchSource`), il est validé par zod, borné et normalisé ici avant tout usage.
 */
import { externalCourseEventSchema, SESSION_TYPE_HINTS, type ExternalCourseEvent } from './contracts';
import type { IntegrationConfig } from './config';
import { fail, IntegrationFailure, normalizeErrorCode, type IntegrationErrorCode } from './errors';
import type { LinkService } from './linking';
import type { PeerClient } from './peer';
import type { CourseOpenResult, CourseStore, LaunchReason, LaunchStore, LinkStore } from './store';
import { randomToken, sha256Hex } from './signing';
import { INTEGRATION_VERSION } from './version';
import type { CourseLaunchRequest, CourseLaunchResponse } from './contracts';

export const LAUNCH_TTL_SECONDS = 300;
export const LAUNCH_PATH = (initiator: string) => `integrations/${initiator}/launch`;

const REASON_TO_CODE: Partial<Record<LaunchReason, IntegrationErrorCode>> = {
  NOT_FOUND: 'NOT_FOUND', EXPIRED: 'LINK_EXPIRED', NONCE_MISMATCH: 'FORBIDDEN', USED: 'GONE', CANCELLED: 'GONE', LINK_NOT_CONNECTED: 'LINK_REVOKED', RATE_LIMITED: 'RATE_LIMITED', INVALID: 'INVALID_PAYLOAD',
};
const failReason = (r: LaunchReason): never => fail(REASON_TO_CODE[r] ?? 'INTERNAL', 'Ouverture du cours refusée.', { details: { reason: r } });

/** Source des cours côté REV-EM : lit SES propres données (jamais un JSON du navigateur) et renvoie un `external-course-event` ou null. */
export interface LaunchSource { resolveEvent(userId: string, input: { eventId: string; tz?: string }): Promise<ExternalCourseEvent | null> }

export interface LaunchDeps {
  cfg: IntegrationConfig; links: LinkService; linkStore: LinkStore; launchStore: LaunchStore; peer: PeerClient;
  /** Côté REV-EM seulement. */ source?: LaunchSource;
  /** Côté LexNote seulement. */ courses?: CourseStore;
  token?: (bytes: number) => string;
}

const clean = (v: string | undefined | null, max: number): string | null => { const t = (v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return t ? t.slice(0, max) : null; };
/** Clé de rapprochement par défaut quand REV-EM n'a pas d'identifiant de matière : le nom normalisé (sans accents, minuscules). */
export const subjectKeyFromName = (name: string) => `name:${name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)}`;

/** Normalise un cours REÇU (donnée non fiable) en paramètres sûrs pour la base. Wall-clock de l'émetteur conservé (date et HH:MM tels qu'affichés dans REV-EM). */
export function planCourseOpen(raw: unknown, ctx: { userId: string; linkId: string; provider: string }) {
  const parsed = externalCourseEventSchema.safeParse(raw);
  if (!parsed.success) return fail('INVALID_PAYLOAD', 'Cours invalide.', { details: { issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ').slice(0, 290) } });
  const e = parsed.data;
  if (e.cancelled) return fail('GONE', 'Ce cours est annulé.');
  const title = clean(e.title, 300) ?? 'Cours';
  const subjectName = clean(e.subject?.name, 160) ?? clean(e.title, 160) ?? 'Cours';
  const type = (SESSION_TYPE_HINTS as readonly string[]).includes(e.sessionTypeHint ?? '') ? (e.sessionTypeHint as string) : 'OTHER';
  const date = e.startsAt.slice(0, 10);
  const t = (iso: string) => iso.slice(11, 16);
  return {
    userId: ctx.userId, provider: ctx.provider, linkId: ctx.linkId,
    eventKey: e.externalId, subjectKey: e.subject?.ref ?? subjectKeyFromName(subjectName), subjectName,
    type, title, date, startTime: e.allDay ? null : t(e.startsAt), endTime: e.allDay ? null : t(e.endsAt),
    teacher: clean(e.teacher, 120), room: clean(e.location, 120),
  };
}

export function createLaunchService(d: LaunchDeps) {
  const { cfg, links, linkStore, launchStore, peer } = d;
  const token = d.token ?? randomToken;

  return {
    /** REV-EM · action de l'étudiant (JWT vérifié) : prépare l'ouverture et renvoie l'URL de LexNote. */
    async startLaunch(userId: string, input: { eventId: string; tz?: string }) {
      if (!d.source) return fail('INTERNAL', 'Source de planning non configurée.');
      // 1) la liaison doit être CONNECTED des DEUX côtés (sonde signée) ; sinon l'étudiant doit d'abord connecter LexNote
      const state = await links.getState(userId, { probe: true });
      if (state.state !== 'CONNECTED' || !state.linkId) {
        const code: IntegrationErrorCode = state.state === 'NOT_CONNECTED' ? 'LINK_NOT_FOUND' : state.state === 'PENDING' ? 'LINK_PENDING' : state.state === 'REVOKED' ? 'LINK_REVOKED' : 'UNAVAILABLE';
        return fail(code, 'LexNote n’est pas connecté.', { details: { state: state.state, ...(state.errorCode ? { errorCode: state.errorCode } : {}) } });
      }
      // 2) le cours est établi PAR LE SERVEUR à partir des données de l'étudiant : un identifiant inconnu ou d'un autre compte = NOT_FOUND
      const event = await d.source.resolveEvent(userId, input);
      if (!event) return fail('NOT_FOUND', 'Évènement introuvable.');
      const nonce = token(32);
      const r = await launchStore.startLaunch({ userId, linkId: state.linkId, eventKey: event.externalId, event, nonceHash: await sha256Hex(nonce), ttlSeconds: LAUNCH_TTL_SECONDS });
      if (r.reason !== 'OK' || !r.intentId) return failReason(r.reason);
      const url = new URL(LAUNCH_PATH(cfg.self), cfg.peerAppUrl.endsWith('/') ? cfg.peerAppUrl : `${cfg.peerAppUrl}/`);
      url.searchParams.set('intent', r.intentId);
      url.hash = `n=${nonce}`;                                       // fragment : jamais envoyé à un serveur, absent des en-têtes Referer
      return { launchIntentId: r.intentId, expiresAt: r.expiresAt!, launchUrl: url.toString() };
    },

    /** LexNote · action de l'étudiant (JWT vérifié) : consomme l'intention auprès de REV-EM puis crée / retrouve matière et séance. */
    async openLaunch(userId: string, intentId: string, nonce: string): Promise<CourseOpenResult & { sessionId: string; subjectId: string }> {
      if (!d.courses) return fail('INTERNAL', 'Création de séances non configurée.');
      const link = await linkStore.getUserLink(userId);
      if (!link) return fail('LINK_NOT_FOUND', 'REV-EM n’est pas connecté.');
      if (link.status !== 'CONNECTED') return fail(link.status === 'REVOKED' ? 'LINK_REVOKED' : 'LINK_PENDING', 'Liaison non active.');
      const res = await peer.sendLaunch({ integrationVersion: INTEGRATION_VERSION, kind: 'course-launch-request', operation: 'REDEEM_LAUNCH', launchIntentId: intentId, nonce, linkId: link.linkId, senderReference: link.localReference });
      if (!res.ok) throw new IntegrationFailure({ ...res.error, code: normalizeErrorCode(res.error.code) });
      if (!res.response.ok || !res.response.event) return fail('NOT_FOUND', 'Cours introuvable.');
      const params = planCourseOpen(res.response.event, { userId, linkId: link.linkId, provider: cfg.peer });
      const out = await d.courses.openCourse(params);
      if (out.reason !== 'OK' || !out.sessionId || !out.subjectId) return failReason(out.reason);
      return { ...out, sessionId: out.sessionId, subjectId: out.subjectId };
    },

    /** REV-EM · côté serveur (requête signée de LexNote, déjà authentifiée) : consomme l'intention, renvoie le cours figé. */
    async handlePeerLaunch(r: CourseLaunchRequest): Promise<CourseLaunchResponse> {
      const link = await links.assertLinkUsable(r.linkId, r.senderReference);
      const x = await launchStore.redeemLaunch({ intentId: r.launchIntentId, nonceHash: await sha256Hex(r.nonce), linkId: link.linkId });
      if (x.reason !== 'OK') return failReason(x.reason);
      return { integrationVersion: INTEGRATION_VERSION, kind: 'course-launch-response', operation: r.operation, ok: true, linkId: link.linkId, event: x.event as ExternalCourseEvent, expiresAt: x.expiresAt };
    },
  };
}
export type LaunchService = ReturnType<typeof createLaunchService>;
