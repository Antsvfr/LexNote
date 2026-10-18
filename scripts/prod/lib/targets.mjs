// Garde-fous des cibles réseau des scripts d'intégration (integration-diagnostic.mjs, real-e2e.mjs).
//
//   mode HÉBERGÉ (défaut)       : chaque projet doit être https://<réf. de 20 caractères>.supabase.co — rien d'autre.
//   mode LOCAL (INTEGRATION_LOCAL=1) : chaque projet doit être http://127.0.0.1|localhost|[::1]:<port> — rien d'autre ; les deux projets
//                                 doivent être sur des ports DIFFÉRENTS (deux piles indépendantes). Les origines des applications ne sont que des
//                                 valeurs d'en-tête `Origin` envoyées par les scripts (jamais des cibles de connexion) : elles n'ont pas à être contrôlées ici,
//                                 mais le mode local les exige explicites (aucun repli sur les adresses officielles — voir les scripts).
// Les deux modes sont exclusifs : INTEGRATION_LOCAL=1 ne permet JAMAIS de viser un hôte distant, et le mode hébergé refuse une adresse locale
// (une faute de frappe ne peut pas faire croire à un test local sur un projet réel, ni l'inverse). Aucun message ne contient de clé.
export const HOSTED_URL = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/;
export const LOOPBACK_URL = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d{2,5})\/?$/;

export const isLocalMode = (env) => env.INTEGRATION_LOCAL === '1';

/**
 * @param env        variables d'environnement
 * @param projects   { nom: url } — les URL des projets Supabase visés (1 ou 2)
 * @returns { local: boolean }
 */
export function assertIntegrationTargets(env, projects) {
  const local = isLocalMode(env);
  const ports = [];
  for (const [name, url] of Object.entries(projects)) {
    if (!url) throw new Error(`${name} : URL absente`);
    if (local) {
      const m = LOOPBACK_URL.exec(url);
      if (!m) throw new Error(`INTEGRATION_LOCAL=1 : ${name} doit être http://127.0.0.1:<port> (ou localhost / [::1]) — jamais un hôte distant`);
      ports.push(m[2]);
    } else {
      if (LOOPBACK_URL.test(url)) throw new Error(`${name} : adresse locale refusée en mode hébergé — pour une pile Supabase locale, définir INTEGRATION_LOCAL=1`);
      if (!HOSTED_URL.test(url)) throw new Error(`${name} doit être https://<réf. de 20 caractères>.supabase.co`);
    }
  }
  if (local) {
    if (new Set(ports).size !== ports.length) throw new Error('INTEGRATION_LOCAL=1 : les deux projets doivent être sur des ports différents (deux piles indépendantes)');
    if ((env.INTEGRATION_ENV ?? 'development') !== 'development') throw new Error('INTEGRATION_LOCAL=1 exige INTEGRATION_ENV=development (ou non défini)');
  }
  return { local };
}
