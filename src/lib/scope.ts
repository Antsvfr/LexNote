/**
 * Portée des préférences locales : certaines clés `localStorage` (réglages de transcription, clé d'API…)
 * sont propres à un compte — un autre compte sur le même navigateur ne doit ni les voir ni les réutiliser.
 */
let scope = '';
export const setStorageScope = (userId: string | null) => { scope = userId ?? ''; };
export const scoped = (key: string) => (scope ? `${key}.${scope}` : key);
