import { useUI } from '@/store/ui';

/** Ouvre la boîte de dialogue « Nouvelle matière » (barre latérale, page Matières, état vide…). */
export function useCreateSubject() {
  const open = useUI((s) => s.openSubjectDialog);
  return () => open();
}
