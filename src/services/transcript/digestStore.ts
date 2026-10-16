/**
 * Cache des SYNTHÈSES INTERMÉDIAIRES d'une longue transcription (une par partie).
 *
 * Avant : une simple `Map` en mémoire → tout était perdu au rechargement de la page, et chaque action relançait l'analyse
 * complète (coût IA). Désormais : IndexedDB sur l'appareil (base `lexnote-digests`), avec la `Map` en mémoire en premier niveau
 * et en repli (navigation privée, IndexedDB indisponible). Rien n'est synchronisé dans le cloud : ce sont des données de calcul.
 *
 * Clé = utilisateur | séance | version de la transcription | version de la partie (empreinte du texte + taille de découpe)
 *       | version du moteur (fournisseur + version des consignes de synthèse).
 * Toute modification de la transcription, du découpage ou des consignes produit donc une nouvelle clé : jamais de synthèse périmée.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/** À incrémenter quand la consigne `digest` (serveur) change de façon significative. */
export const DIGEST_PROMPT_VERSION = 'digest-v1';

export interface DigestKey { userId: string; sessionId: string; transcriptVersion: string; chunkVersion: string; engineVersion: string }
export const digestKey = (k: DigestKey) => [k.userId, k.sessionId, k.transcriptVersion, k.chunkVersion, k.engineVersion].join('|');

export interface DigestStore {
  get(k: DigestKey): Promise<string | undefined>;
  set(k: DigestKey, text: string): Promise<void>;
  /** Oublie les synthèses d'un utilisateur (déconnexion / effacement des données locales). */
  clearUser(userId: string): Promise<void>;
  clear(): Promise<void>;
  readonly persistent: boolean;
}

interface Row { key: string; userId: string; sessionId: string; text: string; createdAt: number }
interface DigestDB extends DBSchema { digests: { key: string; value: Row; indexes: { byUser: string; byCreated: number } } }

const DB_NAME = 'lexnote-digests';
const MEMORY_CAP = 300;
const DISK_CAP = 2000;
const MAX_AGE_MS = 60 * 24 * 3600 * 1000;

export function createDigestStore(opts: { indexedDB?: boolean } = {}): DigestStore {
  const mem = new Map<string, string>();
  const remember = (key: string, v: string) => { if (mem.size >= MEMORY_CAP) mem.delete(mem.keys().next().value!); mem.set(key, v); };
  const canUseIdb = opts.indexedDB !== false && typeof indexedDB !== 'undefined';
  let dbp: Promise<IDBPDatabase<DigestDB> | null> | null = null;
  const db = () => (dbp ??= canUseIdb
    ? openDB<DigestDB>(DB_NAME, 1, {
      upgrade(d) { const s = d.createObjectStore('digests', { keyPath: 'key' }); s.createIndex('byUser', 'userId'); s.createIndex('byCreated', 'createdAt'); },
    }).then(async (d) => {
      d.addEventListener('versionchange', () => d.close());
      await prune(d).catch(() => undefined);
      return d;
    }).catch(() => null)
    : Promise.resolve(null));

  async function prune(d: IDBPDatabase<DigestDB>) {
    const tx = d.transaction('digests', 'readwrite');
    const count = await tx.store.count();
    let excess = count - DISK_CAP; const tooOld = Date.now() - MAX_AGE_MS;
    for (let c = await tx.store.index('byCreated').openCursor(); c; c = await c.continue()) {
      if (excess <= 0 && c.value.createdAt >= tooOld) break;
      await c.delete(); excess--;
    }
    await tx.done;
  }

  return {
    get persistent() { return canUseIdb; },
    async get(k) {
      const key = digestKey(k);
      const hit = mem.get(key);
      if (hit !== undefined) return hit;
      const d = await db();
      const row = d ? await d.get('digests', key).catch(() => undefined) : undefined;
      if (row && row.userId === k.userId) { remember(key, row.text); return row.text; }
      return undefined;
    },
    async set(k, text) {
      const key = digestKey(k);
      remember(key, text);
      const d = await db();
      if (d) await d.put('digests', { key, userId: k.userId, sessionId: k.sessionId, text, createdAt: Date.now() }).catch(() => undefined);
    },
    async clearUser(userId) {
      for (const key of [...mem.keys()]) if (key.startsWith(`${userId}|`)) mem.delete(key);
      const d = await db();
      if (!d) return;
      const tx = d.transaction('digests', 'readwrite');
      for (let c = await tx.store.index('byUser').openCursor(userId); c; c = await c.continue()) await c.delete();
      await tx.done;
    },
    async clear() {
      mem.clear();
      const d = await db();
      if (d) await d.clear('digests').catch(() => undefined);
    },
  };
}
