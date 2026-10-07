import type { CourseSession, Module, Subject } from '@/domain/types';

const DAY = 86_400_000;

/** `YYYY-MM-DD` → ms (minuit local). */
const dayMs = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime(); };

export interface StatCard {
  value: string;
  /** Texte d'évolution : uniquement des valeurs réellement calculables, sinon une information neutre. */
  note: string;
  /** Vrai si l'évolution est positive (flèche affichée). */
  up: boolean;
}

export interface DashboardStats {
  /** Séances (CM, TD, TP… confondus). */
  sessions: StatCard;
  subjects: StatCard;
  words: StatCard;
  time: StatCard;
}

/** « 3 h » / « 40 min » */
export function shortDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/**
 * Statistiques du tableau de bord, calculées sur les vraies données.
 * « Cette semaine » = CM dont la DATE tombe dans les 7 derniers jours. Aucun pourcentage n'est inventé :
 * LexNote ne conserve pas d'historique des mots écrits, donc pas de « +18 % ».
 */
export function computeDashboardStats(sessions: CourseSession[], subjects: Subject[], modules: Module[], now = Date.now()): DashboardStats {
  const inWeek = sessions.filter((s) => now - dayMs(s.date) <= 7 * DAY && dayMs(s.date) <= now + DAY);
  const inMonth = sessions.filter((s) => now - dayMs(s.date) <= 30 * DAY && dayMs(s.date) <= now + DAY);
  const totalWords = sessions.reduce((n, s) => n + s.wordCount, 0);
  const totalSec = sessions.reduce((n, s) => n + s.durationSec, 0);
  const weekWords = inWeek.reduce((n, s) => n + s.wordCount, 0);
  const weekSec = inWeek.reduce((n, s) => n + s.durationSec, 0);
  const newSubjects = subjects.filter((s) => now - new Date(s.createdAt).getTime() <= 7 * DAY).length;

  return {
    sessions: {
      value: String(sessions.length),
      up: inWeek.length > 0 || inMonth.length > 0,
      note: inWeek.length ? `+${inWeek.length} cette semaine` : inMonth.length ? `+${inMonth.length} ce mois-ci` : 'Aucun récent',
    },
    subjects: {
      value: String(subjects.length),
      up: newSubjects > 0,
      note: newSubjects ? `+${newSubjects} cette semaine` : plural(modules.length, 'module'),
    },
    words: {
      value: totalWords.toLocaleString('fr-FR'),
      up: weekWords > 0,
      note: weekWords ? `+${weekWords.toLocaleString('fr-FR')} cette semaine` : 'Aucun cette semaine',
    },
    time: {
      value: shortDuration(totalSec).replace(' min', totalSec >= 3600 ? '' : ' min'),
      up: weekSec > 0,
      note: weekSec ? `+${shortDuration(weekSec)} cette semaine` : 'Aucun cette semaine',
    },
  };
}

/**
 * Avancement honnête du groupe d'une séance : séances terminées / séances du même module
 * (ou, sans module, de la même matière sans module).
 */
export function groupProgress(sessions: CourseSession[], of: Pick<CourseSession, 'moduleId' | 'subjectId'>): { done: number; total: number; pct: number; scope: 'module' | 'subject' } {
  const scope = of.moduleId ? 'module' : 'subject';
  const list = sessions.filter((s) => (of.moduleId ? s.moduleId === of.moduleId : s.subjectId === of.subjectId && !s.moduleId));
  const done = list.filter((s) => s.status === 'completed').length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0, scope };
}

/** Séance à reprendre : la plus récente « en cours », sinon la plus récente tout court. */
export function pickResumeSession(sessions: CourseSession[]): CourseSession | undefined {
  const byRecent = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return byRecent.find((s) => s.status === 'in_progress') ?? byRecent[0];
}
