/**
 * Cet appareil, vu par LexNote — sans empreinte de navigateur, sans secret.
 *
 *  - `id` : UUID tiré au hasard la première fois (localStorage), pour nommer l'appareil dans « Appareils connectés » ;
 *  - `remember` : choix « Rester connecté sur cet appareil » fait à la connexion ;
 *  - marqueur de SESSION DE NAVIGATEUR : un cookie sans date d'expiration (`lexnote_bs=1`), effacé par le navigateur à sa fermeture.
 *    Il ne contient rien de sensible : il sert seulement à savoir, au démarrage, si le navigateur a été fermé depuis la dernière visite.
 *
 * La session elle-même reste celle de Supabase (jeton d'accès + jeton de rafraîchissement, clé `lexnote-auth` du localStorage,
 * PARTAGÉE par tous les onglets et par l'application installée du même profil de navigateur — un seul rafraîchissement à la fois,
 * coordonné par supabase-js). Aucun mot de passe n'est jamais enregistré, sous aucune forme.
 *
 * « Rester connecté » DÉCOCHÉ : à la réouverture du navigateur (cookie absent), la session stockée est révoquée et effacée avant
 * tout usage ; les nouveaux onglets de la MÊME session de navigateur restent connectés (indispensable à l'ouverture depuis REV-EM).
 */
const KEY = 'lexnote-device';
const COOKIE = 'lexnote_bs';

export interface DeviceInfo { id: string; remember: boolean; createdAt: string }

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)));

export function readDevice(): DeviceInfo {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<DeviceInfo> | null;
    if (d && typeof d.id === 'string' && /^[0-9a-f-]{36}$/i.test(d.id)) return { id: d.id, remember: d.remember === true, createdAt: d.createdAt ?? new Date().toISOString() };
  } catch { /* stockage indisponible ou valeur illisible : nouvel appareil */ }
  // Appareil déjà connecté AVANT cette version (session persistante, comportement historique) : on conserve ce comportement tant que
  // l'étudiant ne décoche pas « Rester connecté » — pas de déconnexion surprise à la mise à jour. Nouvel appareil : décoché par défaut.
  const fresh: DeviceInfo = { id: uuid(), remember: hadSessionBeforeThisVersion(), createdAt: new Date().toISOString() };
  writeDevice(fresh);
  return fresh;
}
function hadSessionBeforeThisVersion(): boolean {
  try {
    if (localStorage.getItem('lexnote-auth')) return true;                                       // session Supabase stockée
    return !!(JSON.parse(localStorage.getItem('lexnote-mock-auth') ?? 'null') as { sessionUserId?: string } | null)?.sessionUserId;   // backend de test
  } catch { return false; }
}
function writeDevice(d: DeviceInfo) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* navigation privée stricte : rien n'est conservé */ } }

export function setRemember(remember: boolean) { writeDevice({ ...readDevice(), remember }); }

export function isNewBrowserSession(): boolean {
  try { return !document.cookie.split(';').some((c) => c.trim() === `${COOKIE}=1`); } catch { return false; }
}
export function markBrowserSession() {
  try { document.cookie = `${COOKIE}=1; path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch { /* sans effet */ }
}

/** « Rester connecté » décoché ET navigateur rouvert depuis : la session stockée doit être abandonnée. */
export function shouldDiscardStoredSession(): boolean { return !readDevice().remember && isNewBrowserSession(); }

export const isStandalone = (): boolean => {
  try { return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true; } catch { return false; }
};

/** Libellé lisible et grossier (« Chrome — macOS ») : jamais d'identifiant matériel, de version précise ni d'empreinte. */
export function deviceLabel(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Système inconnu';
  return `${browser} — ${os}`;
}
