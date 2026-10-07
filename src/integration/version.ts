/**
 * Version du contrat d'intégration REV-EM ⇄ LexNote.
 *
 * Règles (voir docs/REVEM_LEXNOTE_INTEGRATION.md §7) :
 *  - le MAJEUR (`v1`) change à toute rupture : champ retiré, renommé, sémantique modifiée, enum restreint ;
 *  - tout ajout rétro-compatible (champ optionnel, valeur d'enum documentée « ouverte ») ne change PAS le majeur ;
 *  - un consommateur IGNORE les champs inconnus et REFUSE (UNSUPPORTED_VERSION) un majeur qu'il ne connaît pas.
 */
export const INTEGRATION_NAMESPACE = 'lexnote-revem';
export const INTEGRATION_VERSION = 'lexnote-revem/v1' as const;
/** Majeurs que CETTE application sait lire. Ajouter `2` ici (avec un adaptateur) pour migrer sans casser l'autre application. */
export const SUPPORTED_MAJORS: readonly number[] = [1];

const RE = /^lexnote-revem\/v(\d{1,3})$/;
export const majorOf = (version: string): number | null => { const m = RE.exec(version); return m ? Number(m[1]) : null; };
export const isSupportedVersion = (version: string): boolean => { const m = majorOf(version); return m !== null && SUPPORTED_MAJORS.includes(m); };
