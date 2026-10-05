import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { ConfirmHost, PromptHost } from '@/components/confirm';
import { Toasts } from '@/components/Toasts';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { SubjectsPage } from '@/features/library/SubjectsPage';
import { SubjectPage } from '@/features/library/SubjectPage';
import { ModulePage } from '@/features/library/ModulePage';
import { SessionsPage } from '@/features/library/SessionsPage';
import { NewCmDialog } from '@/features/library/NewCmDialog';
import { SearchPage } from '@/features/search/SearchPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { applyTheme, useUI } from '@/store/ui';
import { usePwaUpdate } from '@/lib/pwa';

// L'éditeur (TipTap/ProseMirror) est le plus gros morceau : chargé à la demande.
const EditorPage = lazy(() => import('@/features/editor/EditorPage').then((m) => ({ default: m.EditorPage })));
const RecapPage = lazy(() => import('@/features/recap/RecapPage').then((m) => ({ default: m.RecapPage })));

export function App() {
  const theme = useUI((s) => s.theme);
  usePwaUpdate();

  // Suit le thème système quand la préférence est "Système".
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<div className="editor-loading" aria-busy="true">Chargement…</div>}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Dashboard />} />
              <Route path="subjects" element={<SubjectsPage />} />
              <Route path="subjects/:subjectId" element={<SubjectPage />} />
              <Route path="modules/:moduleId" element={<ModulePage />} />
              <Route path="sessions" element={<SessionsPage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="session/:sessionId/recap" element={<RecapPage />} />
              <Route path="*" element={<Dashboard />} />
            </Route>
            <Route path="session/:sessionId" element={<EditorPage />} />
          </Routes>
        </Suspense>
        <NewCmDialog />
        <CommandPalette />
        <ConfirmHost />
        <PromptHost />
        <Toasts />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
