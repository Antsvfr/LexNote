import { Atom, BookOpen, Briefcase, Calculator, FlaskConical, Globe, Landmark, Languages, Scale, type LucideIcon } from 'lucide-react';

/** Icônes proposées pour une matière (facultatif). Stockées par nom : jamais d'image à charger. */
export const SUBJECT_ICONS: Record<string, { label: string; Icon: LucideIcon }> = {
  book: { label: 'Livre', Icon: BookOpen },
  scale: { label: 'Droit', Icon: Scale },
  landmark: { label: 'Institutions', Icon: Landmark },
  calculator: { label: 'Calcul', Icon: Calculator },
  briefcase: { label: 'Gestion', Icon: Briefcase },
  flask: { label: 'Sciences', Icon: FlaskConical },
  atom: { label: 'Physique', Icon: Atom },
  globe: { label: 'Monde', Icon: Globe },
  languages: { label: 'Langues', Icon: Languages },
};
export const SUBJECT_ICON_KEYS = Object.keys(SUBJECT_ICONS);
