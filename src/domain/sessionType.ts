/**
 * Types de séances. CM, TD, TP… partagent le MÊME modèle (`CourseSession`) : ajouter un type =
 * ajouter une ligne ici (aucune table, aucun écran dupliqué).
 */
export const SESSION_TYPES = [
  { id: 'CM', label: 'CM', long: 'Cours magistral', tone: 'red' },
  { id: 'TD', label: 'TD', long: 'Travaux dirigés', tone: 'blue' },
  { id: 'TP', label: 'TP', long: 'Travaux pratiques', tone: 'green' },
  { id: 'COURSE', label: 'Cours', long: 'Cours', tone: 'orange' },
  { id: 'SEMINAR', label: 'Séminaire', long: 'Séminaire', tone: 'purple' },
  { id: 'WORKSHOP', label: 'Atelier', long: 'Atelier', tone: 'cyan' },
  { id: 'REVISION', label: 'Révision', long: 'Séance de révision', tone: 'pink' },
  { id: 'OTHER', label: 'Autre', long: 'Autre', tone: 'slate' },
] as const;

export type SessionType = (typeof SESSION_TYPES)[number]['id'];
export type SessionTone = (typeof SESSION_TYPES)[number]['tone'];

export const SESSION_TYPE_IDS = SESSION_TYPES.map((t) => t.id) as SessionType[];
/** Types regroupés sous « Autres » dans les filtres. */
export const MAIN_TYPES: SessionType[] = ['CM', 'TD', 'TP'];

export function isSessionType(v: unknown): v is SessionType {
  return typeof v === 'string' && (SESSION_TYPE_IDS as string[]).includes(v);
}
export const typeInfo = (t: SessionType | string) => SESSION_TYPES.find((x) => x.id === t) ?? SESSION_TYPES[SESSION_TYPES.length - 1]!;
export const typeLabel = (t: SessionType | string) => typeInfo(t).label;
