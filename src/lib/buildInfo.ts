/** Identité de la version en cours d'exécution : numéro, commit du build, date. Aucune donnée personnelle. */
export interface BuildInfo { version: string; sha: string; shortSha: string; builtAt: string; label: string }

export function getBuildInfo(): BuildInfo {
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
  const sha = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'unknown';
  const builtAt = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';
  const shortSha = sha === 'unknown' ? 'inconnu' : sha.slice(0, 7);
  return { version, sha, shortSha, builtAt, label: `v${version} (${shortSha})` };
}
