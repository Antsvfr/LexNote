/** Profil d'études — tout est facultatif et ne conditionne aucune fonctionnalité. */
/** Domaine d'études : FACULTATIF, ne restreint jamais aucune fonctionnalité (toutes les filières ont accès à tout). */
export const FIELDS = ['École de commerce', 'Économie / gestion', 'Droit', 'Médecine / santé', 'Sciences', 'Ingénierie', 'Informatique', 'Lettres / langues', 'Sciences humaines', 'Autre'] as const;
/** Usage principal : facultatif, aide seulement à adapter les prochaines versions. */
export const PRIMARY_USES = [
  { id: 'notes', label: 'Prendre des notes en cours' },
  { id: 'transcribe', label: 'Transcrire mes cours' },
  { id: 'revise', label: 'Réviser et préparer les examens' },
  { id: 'all', label: 'Un peu de tout' },
] as const;

