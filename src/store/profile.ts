import { create } from 'zustand';

/** Profil local (jamais envoyé). Prénom et citation du bandeau d'accueil. */
export interface Profile { firstName: string; quote: string }

export const DEFAULT_QUOTE = 'Comprendre aujourd’hui, maîtriser demain.';
const KEY = 'lexnote.profile';

function load(): Profile {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Profile> | null;
    return { firstName: raw?.firstName?.trim() ?? '', quote: raw?.quote?.trim() || DEFAULT_QUOTE };
  } catch {
    return { firstName: '', quote: DEFAULT_QUOTE };
  }
}

export const useProfile = create<Profile & { update(p: Partial<Profile>): void }>((set, get) => ({
  ...load(),
  update: (p) => {
    set(p);
    const { firstName, quote } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ firstName, quote })); } catch { /* préférence non persistée */ }
  },
}));

export function greeting(firstName: string): string {
  return firstName.trim() ? `Bon cours, ${firstName.trim()} !` : 'Bon cours !';
}
