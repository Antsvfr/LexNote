import { create } from 'zustand';
import type { CourseSession, ISODate, LibrarySnapshot, Module, Subject } from '@/domain/types';
import { createModule, createSession, createSubject, nextSessionNumber } from '@/domain/session';
import { computeDemoRemoval } from '@/domain/demo';
import type { ChangeSet, StorageAdapter } from '@/services/storage/types';
import { countWords, makeExcerpt } from '@/lib/text';
import { nextSubjectColor } from '@/lib/palette';
import { toast } from './toasts';

interface LibraryState extends LibrarySnapshot {
  ready: boolean;
  storageKind: 'indexeddb' | 'memory' | null;
  persistent: boolean;

  init(adapter: StorageAdapter): Promise<void>;

  addSubject(name: string): Promise<Subject>;
  renameSubject(id: string, name: string): Promise<void>;
  deleteSubject(id: string): Promise<void>;

  addModule(subjectId: string, name: string): Promise<Module>;
  renameModule(id: string, name: string): Promise<void>;
  deleteModule(id: string): Promise<void>;

  addSession(input: { subjectId: string; moduleId: string; title: string; date: ISODate; number?: number | null }): Promise<CourseSession>;
  updateSession(id: string, patch: Partial<Pick<CourseSession, 'title' | 'number' | 'date' | 'moduleId' | 'subjectId'>>): Promise<void>;
  deleteSession(id: string): Promise<void>;
  saveNotes(id: string, input: { content: unknown; plainText: string; durationSec?: number }): Promise<void>;
  setDuration(id: string, durationSec: number): Promise<void>;
  setStatus(id: string, status: 'in_progress' | 'completed'): Promise<void>;

  removeDemoData(): Promise<void>;
  reload(): Promise<void>;
  loadNotes(id: string): Promise<unknown | undefined>;
  exportAll: StorageAdapter['exportAll'];
  wipe(): Promise<void>;
}

let adapter: StorageAdapter | null = null;
const db = (): StorageAdapter => {
  if (!adapter) throw new Error('Le stockage LexNote n’est pas initialisé.');
  return adapter;
};

const stamp = () => new Date().toISOString();
const replace = <T extends { id: string }>(list: T[], item: T) => list.map((x) => (x.id === item.id ? item : x));

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
    ready: false, storageKind: null, persistent: false,

    async init(a) {
      adapter = a;
      const lib = await a.loadLibrary();
      set({ ...lib, ready: true, storageKind: a.kind, persistent: a.persistent });
    },
    async reload() {
      set({ ...(await db().loadLibrary()) });
    },

    /* --- matières --- */
    async addSubject(name) {
      const subject = createSubject(name, nextSubjectColor(get().subjects.map((s) => s.color)));
      set((s) => ({ subjects: [...s.subjects, subject] }));
      await persist({ putSubjects: [subject] });
      return subject;
    },
    async renameSubject(id, name) {
      const cur = get().subjects.find((s) => s.id === id);
      if (!cur || !name.trim()) return;
      const next = { ...cur, name: name.trim(), updatedAt: stamp() };
      set((s) => ({ subjects: replace(s.subjects, next) }));
      await persist({ putSubjects: [next] });
    },
    async deleteSubject(id) {
      const mods = get().modules.filter((m) => m.subjectId === id).map((m) => m.id);
      const sess = get().sessions.filter((s) => s.subjectId === id).map((s) => s.id);
      set((s) => ({
        subjects: s.subjects.filter((x) => x.id !== id),
        modules: s.modules.filter((x) => x.subjectId !== id),
        sessions: s.sessions.filter((x) => x.subjectId !== id),
      }));
      await persist({ deleteSubjects: [id], deleteModules: mods, deleteSessions: sess });
    },

    /* --- modules --- */
    async addModule(subjectId, name) {
      const mod = createModule(subjectId, name);
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
      const sess = get().sessions.filter((s) => s.moduleId === id).map((s) => s.id);
      set((s) => ({ modules: s.modules.filter((x) => x.id !== id), sessions: s.sessions.filter((x) => x.moduleId !== id) }));
      await persist({ deleteModules: [id], deleteSessions: sess });
    },

    /* --- séances --- */
    async addSession(input) {
      const number = input.number === undefined ? nextSessionNumber(get().sessions, input.moduleId) : input.number;
      const session = createSession({ ...input, number });
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
        isDemo: undefined, // l'étudiant a écrit dedans : ce n'est plus une donnée de démo
      };
      set((s) => ({ sessions: replace(s.sessions, next) }));
      await persist({ putSessions: [next], putNotes: [{ sessionId: id, content, updatedAt: t }] });
    },
    async setDuration(id, durationSec) {
      const cur = get().sessions.find((s) => s.id === id);
      if (!cur || cur.durationSec === durationSec) return;
      // On ne touche pas à `updatedAt` : passer du temps sur un CM n'est pas une modification.
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

    /* --- démo / données --- */
    async removeDemoData() {
      const changes = computeDemoRemoval(get());
      await persist(changes);
      await get().reload();
    },
    loadNotes: async (id) => (await db().getNotes(id))?.content,
    exportAll: () => db().exportAll(),
    async wipe() {
      await db().clearAll();
      set({ subjects: [], modules: [], sessions: [] });
    },
  };
});

/* --- sélecteurs purs --- */
export const selectLastSession = (sessions: CourseSession[]) =>
  [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
