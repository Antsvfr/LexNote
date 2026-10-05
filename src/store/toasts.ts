import { create } from 'zustand';
import { newId } from '@/lib/ids';

export interface Toast {
  id: string;
  tone: 'info' | 'error' | 'success';
  message: string;
  action?: { label: string; run: () => void };
  sticky?: boolean;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = newId('t');
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    if (!t.sticky) setTimeout(() => get().dismiss(id), t.tone === 'error' ? 8000 : 4000);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  info: (message: string) => useToasts.getState().push({ tone: 'info', message }),
  success: (message: string) => useToasts.getState().push({ tone: 'success', message }),
  error: (message: string) => useToasts.getState().push({ tone: 'error', message }),
};
