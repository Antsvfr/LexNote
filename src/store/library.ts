import { create } from 'zustand';
import type { CaptureSummary } from '@/domain/capture';
import type { CourseSession, ISODate, LibrarySnapshot, Module, Subject } from '@/domain/types';
import type { SessionType } from '@/domain/sessionType';
import { createModule, createSession, createSubject, nextSessionNumber, type SubjectInput } from '@/domain/session';
import type { ChangeSet, StorageAdapter } from '@/services/storage/types';
import { countWords, makeExcerpt } from '@/lib/text';
import { nextSubjectColor } from '@/lib/palette';
import { toast } from './toasts';

export interface NewSessionInput {
  subjectId: string;
  moduleId?: string | null;
  type: SessionType;
  title: string;
  date: ISODate;
  startTime?: string;
  endTime?: string;
  teacher?: string;
  room?: string;
  number?: number | null;
}

interface LibraryState extends LibrarySnapshot {
  ready: boolean;
  userId: string | null;
  storageKind: 'indexeddb' | 'memory' | null;
  persistent: boolean;

  init(adapter: StorageAdapter, userId: string): Promise<void>;
  /** Vide TOUT l'état en mémoire (déconnexion) : aucune donnée de l'utilisateur précédent ne doit rester visible. */
  reset(): void;

  addSubject(input: Omit<SubjectInput, 'color'> & { color?: string }): Promise<Subject>;
  updateSubject(id: string, patch: Partial<SubjectInput>): Promise<void>;
  renameSubject(id: string, name: string): Promise<void>;
  deleteSubject(id: string): Promise<void>;

  addModule(subjectId: string, name: string): Promise<Module>;
  renameModule(id: string, name: string): Promise<void>;
  deleteModule(id: string): Promise<void>;

  addSession(input: NewSessionInput): Promise<CourseSession>;
  updateSession(id: string, patch: Partial<Pick<CourseSession, 'title' | 'number' | 'date' | 'moduleId' | 'subjectId' | 'thumbnail' | 'type' | 'startTime' | 'endTime' | 'teacher' | 'room'>>): Promise<void>;
  deleteSession(id: string): Promise<void>;
  saveNotes(id: string, input: { content: unknown; plainText: string; durationSec?: number }): Promise<void>;
  setDuration(id: string, durationSec: number): Promise<void>;
  setStatus(id: string, status: 'in_progress' | 'completed'): Promise<void>;
  setCaptureSummary(id: string, summary: CaptureSummary): Promise<void>;

  reload(): Promise<void>;
  loadNotes(id: string): Promise<unknown | undefined>;
  exportAll: StorageAdapter['exportAll'];
  wipe(): Promise<void>;
  /** Appelé par la synchronisation quand le cloud a modifié des données locales. */
  applyRemote(removedSessionIds: string[]): Promise<void>;
}

let adapter: StorageAdapter | null = null;
const db = (): StorageAdapter => {
  if (!adapter) throw new Error('Le stockage LexNote n’est pas initialisé.');
  return adapter;
};

/**
 * Données liées à une séance mais stockées ailleurs (audio, transcription…) : elles s'abonnent ici
 * pour être supprimées avec la séance. Les échecs sont journalisés, jamais bloquants.
 */
type RemovalHook = (sessionIds: string[]) => Promise<void> | void;
const removalHooks: RemovalHook[] = [];
const wipeHooks: (() => Promise<void> | void)[] = [];
export const onSessionsRemoved = (h: RemovalHook) => { removalHooks.push(h); };
type SubjectsHook = (subjectIds: string[]) => Promise<void> | void;
const subjectHooks: SubjectsHook[] = [];
export const onSubjectsRemoved = (h: SubjectsHook) => { subjectHooks.push(h); };
export const onLibraryWiped = (h: () => Promise<void> | void) => { wipeHooks.push(h); };
async function notifyRemoved(ids: string[]) {
  if (!ids.length) return;
  for (const h of removalHooks) { try { await h(ids); } catch (e) { console.error('[LexNote] nettoyage lié à la séance', e); } }
}

const stamp = () => new Date().toISOString();
const replace = <T extends { id: string }>(list: T[], item: T) => list.map((x) => (x.id === item.id ? item : x));
const uid = (get: () => LibraryState) => {
  const u = get().userId;
  if (!u) throw new Error('Aucun utilisateur connecté.');
  return u;
};

export const useLibrary = create<LibraryState>((set, get) => {
  /** Applique le changement en base ; en cas d'échec, prévient l'étudiant sans perdre l'état en mémoire. */
  async function persist(changes: ChangeSet) {
    try {
      await db().commit(changes);
    } catch (err) {
      console.error('[LexNote] Échec d’écriture locale', err);
      toast.error("Impossible d'enregistrer sur cet appareil. Exportez vos notes depuis Réglages.");
      throw err;
    }
  }

  return {
    subjects: [], modules: [], sessions: [],
    ready: false, userId: null, storageKind: null, persistent: false,

    async init(a, userId) {
      adapter = a;
      const lib = await a.loadLibrary();
      set({ ...lib, ready: true, userId, storageKind: a.kind, persistent: a.persistent });
    },
    reset() {
      adapter = null;
      set({ subjects: [], modules: [], sessions: [], ready: false, userId: null, storageKind: null, persistent: false });
    },
    async reload() { set({ ...(await db().loadLibrary()) }); },
    async applyRemote(removedSessionIds) {
      await get().reload();
      await notifyRemoved(removedSessionIds);
    },

    /* --- matières --- */
    async addSubject(input) {
      const subject = createSubject(uid(get), { ...input, color: input.color ?? nextSubjectColor(get().subjects.map((s) => s.color)) });
      set((s) => ({ subjects: [...s.subjects, subject] }));
      await persist({ putSubjects: [subject] });
      return subject;
    },
    async updateSubject(id, patch) {
      const cur = get().subjects.find((s) => s.id === id);
      if (!cur) return;
      const next: Subject = { ...cur, ...patch, name: (patch.name ?? cur.name).trim() || cur.name, updatedAt: stamp() };
      set((s) => ({ subjects: replace(s.subjects, next) }));
      await persist({ putSubjects: [next] });
    },
    async renameSubject(id, name) { if (name.trim()) await get().updateSubject(id, { name }); },
    async deleteSubject(id) {
      const mods = get().modules.filter((m) => m.subjectId === id).map((m) => m.id);
      const sess = get().sessions.filter((s) => s.subjectId === id).map((s) => s.id);
      set((s) => ({
        subjects: s.subjects.filter((x) => x.id !== id),
        modules: s.modules.filter((x) => x.subjectId !== id),
        sessions: s.sessions.filter((x) => x.subjectId !== id),
      }));
      await persist({ deleteSubjects: [id], deleteModules: mods, deleteSessions: sess });
      await notifyRemoved(sess);
      for (const h of subjectHooks) { try { await h([id]); } catch (e) { console.error(e); } }
    },

    /* --- modules --- */
    async addModule(subjectId, name) {
      const mod = createModule(uid(get), subjectId, name);
      set((s) => ({ modules: [...s.modules, mod] }));
      await persist({ putModules: [mod] });
      return mod;
    },
    async renameModule(id, name) {
      const cur = get().modules.find((m) => m.id === id);
      if (!cur || !name.trim()) return;
      const next = { ...cur, name: name.trim(), updatedAt: stamp() };
      set((s) => ({ modules: replace(s.modules, next) }));
      await persist({ putModules: [next] });
    },
    async deleteModule(id) {
      // Les séances du module ne sont pas supprimées : elles restent rattachées à la matière, sans module.
      const detached = get().sessions.filter((s) => s.moduleId === id).map((s) => ({ ...s, moduleId: null, updatedAt: stamp() }));
      set((s) => ({ modules: s.modules.filter((x) => x.id !== id), sessions: s.sessions.map((x) => detached.find((d) => d.id === x.id) ?? x) }));
      await persist({ deleteModules: [id], putSessions: detached });
    },

    /* --- séances --- */
    async addSession(input) {
      const number = input.number === undefined ? nextSessionNumber(get().sessions, input.subjectId, input.type) : input.number;
      const session = createSession(uid(get), { ...input, number });
      set((s) => ({ sessions: [...s.sessions, session] }));
      await persist({ putSessions: [session] });
      return session;
    },
    async updateSession(id, patch) {
      const cur = get().sessions.find((s) => s.id === id);
      if (!cur) return;
      const next: CourseSession = { ...cur, ...patch, updatedAt: stamp() };
      if (patch.title !== undefined) next.title = patch.title.trim();
      set((s) => ({ sessions: replace(s.sessions, next) }));
      await persist({ putSessions: [next] });
    },
    async deleteSession(id) {
      set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }));
      await persist({ deleteSessions: [id] });
      await notifyRemoved([id]);
    },
    async saveNotes(id, { content, plainText, durationSec }) {
      const cur = get().sessions.find((s) => s.id === id);
      if (!cur) return;
      const t = stamp();
      const next: CourseSession = {
        ...cur,
        wordCount: countWords(plainText),
        excerpt: makeExcerpt(plainText),
        searchText: plainText,
        durationSec: durationSec ?? cur.durationSec,
        updatedAt: t,
      };
      set((s) => ({ sessions: replace(s.sessions, next) }));
      await persist({ putSessions: [next], putNotes: [{ sessionId: id, content, updatedAt: t }] });
    },
    async setDuration(id, durationSec) {
      const cur = get().sessions.find((s) => s.id === id);
      if (!cur || cur.durationSec === durationSec) return;
      // On ne touche pas à `updatedAt` : passer du temps sur une séance n'est pas modifier ses notes.
      // (La ligne est tout de même marquée « à envoyer » par l'adaptateur.)
      const next = { ...cur, durationSec };
      set((s) => ({ sessions: replace(s.sessions, next) }));
      await persist({ putSessions: [next] });
    },
    async setStatus(id, status) {
      const cur = get().sessions.find((s) => s.id === id);
      if (!cur) return;
      const t = stamp();
      const next: CourseSession = { ...cur, status, completedAt: status === 'completed' ? t : null, updatedAt: t };
      set((s) => ({ sessions: replace(s.sessions, next) }));
      await persist({ putSessions: [next] });
    },
    async setCaptureSummary(id, summary) {
      const cur = get().sessions.find((s) => s.id === id);
      if (!cur) return;
      const next = { ...cur, captureSummary: summary };
      set((s) => ({ sessions: replace(s.sessions, next) }));
      await persist({ putSessions: [next] });
    },

    loadNotes: async (id) => (await db().getNotes(id))?.content,
    exportAll: () => db().exportAll(),
    async wipe() {
      // Suppression « douce » : chaque élément reçoit une pierre tombale, donc l'effacement est aussi propagé au cloud de CE compte.
      const { subjects, modules, sessions } = get();
      const sessionIds = sessions.map((x) => x.id);
      set({ subjects: [], modules: [], sessions: [] });
      await persist({ deleteSubjects: subjects.map((x) => x.id), deleteModules: modules.map((x) => x.id), deleteSessions: sessionIds });
      await notifyRemoved(sessionIds);
      for (const h of subjectHooks) { try { await h(subjects.map((x) => x.id)); } catch (e) { console.error(e); } }
      for (const h of wipeHooks) { try { await h(); } catch (e) { console.error(e); } }
    },
  };
});

/* --- sélecteurs purs --- */
export const selectLastSession = (sessions: CourseSession[]) =>
  [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
