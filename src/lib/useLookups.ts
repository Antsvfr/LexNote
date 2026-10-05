import { useMemo } from 'react';
import { useLibrary } from '@/store/library';

/** Index par id, recalculés seulement quand les listes changent. */
export function useLookups() {
  const subjects = useLibrary((s) => s.subjects);
  const modules = useLibrary((s) => s.modules);
  return useMemo(
    () => ({
      subjectById: new Map(subjects.map((s) => [s.id, s])),
      moduleById: new Map(modules.map((m) => [m.id, m])),
    }),
    [subjects, modules],
  );
}
