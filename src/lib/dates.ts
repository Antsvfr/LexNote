const fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Interprète `YYYY-MM-DD` en date locale (évite le décalage UTC). */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export const formatDateLong = (iso: string) => fmtLong.format(parseISODate(iso));
export const formatDateShort = (iso: string) => fmtShort.format(parseISODate(iso));

export function formatRelative(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const min = 60_000, hour = 3_600_000, day = 86_400_000;
  if (abs < min) return "à l'instant";
  if (abs < hour) return rtf.format(Math.round(diff / min), 'minute');
  if (abs < day) return rtf.format(Math.round(diff / hour), 'hour');
  if (abs < day * 30) return rtf.format(Math.round(diff / day), 'day');
  return fmtShort.format(new Date(iso));
}

/** `3725` → `1 h 02` ; `95` → `1 min` ; `0` → `—`. */
export function formatDuration(sec: number): string {
  if (!sec || sec < 30) return sec > 0 ? '< 1 min' : '—';
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

/** Chronomètre `H:MM:SS` / `MM:SS`. */
export function formatClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
