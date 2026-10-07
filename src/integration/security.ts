/**
 * Garde-fou « aucun secret ne traverse la frontière » (docs §5).
 * Toute enveloppe sortante ET entrante est inspectée : clés interdites (service_role, refresh_token, access_token, apikey…)
 * et valeurs ressemblant à un JWT, une clé secrète Supabase/Anthropic/OpenAI ou un en-tête `Bearer`.
 * C'est un filet de sécurité (défense en profondeur), PAS la protection principale : les contrats ne contiennent de toute façon aucun champ prévu pour un jeton.
 */
const FORBIDDEN_KEY = /(^|[^a-z])(service[_-]?role|refresh[_-]?token|access[_-]?token|id[_-]?token|api[_-]?key|apikey|secret|password|passwd|authorization|bearer|jwt|private[_-]?key|session[_-]?token|cookie)([^a-z]|$)/i;
const SECRET_VALUE: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/, // JWT (anon, service_role, access token…)
  /\bsb_secret_[A-Za-z0-9_-]{8,}/, /\bsbp_[A-Za-z0-9]{16,}/,         // clés Supabase
  /\bsk-[A-Za-z0-9_-]{16,}/, /\bsk-ant-[A-Za-z0-9_-]{8,}/,           // OpenAI / Anthropic
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
];

export interface SecretFinding { path: string; reason: 'forbidden-key' | 'secret-value' }

export function findSecrets(value: unknown, path = '$', out: SecretFinding[] = [], depth = 0): SecretFinding[] {
  if (depth > 20) return out;
  if (typeof value === 'string') {
    if (SECRET_VALUE.some((re) => re.test(value))) out.push({ path, reason: 'secret-value' });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findSecrets(v, `${path}[${i}]`, out, depth + 1));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(k)) out.push({ path: `${path}.${k}`, reason: 'forbidden-key' });
      findSecrets(v, `${path}.${k}`, out, depth + 1);
    }
  }
  return out;
}
