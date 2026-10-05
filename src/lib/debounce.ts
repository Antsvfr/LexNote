export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Exécute immédiatement l'appel en attente (renvoie la promesse éventuelle). */
  flush(): void;
  cancel(): void;
  pending(): boolean;
}

/**
 * Debounce avec `maxWait` : une frappe continue déclenche quand même
 * une sauvegarde au bout de `maxWait` ms.
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number, maxWait = wait * 10): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;

  const clear = () => {
    if (timer) clearTimeout(timer);
    if (maxTimer) clearTimeout(maxTimer);
    timer = maxTimer = undefined;
  };
  const run = () => {
    const args = lastArgs;
    clear();
    lastArgs = undefined;
    if (args) fn(...args);
  };

  const d = ((...args: A) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, wait);
    if (!maxTimer) maxTimer = setTimeout(run, maxWait);
  }) as Debounced<A>;
  d.flush = run;
  d.cancel = () => {
    clear();
    lastArgs = undefined;
  };
  d.pending = () => lastArgs !== undefined;
  return d;
}
