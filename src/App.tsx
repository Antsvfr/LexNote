import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
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
import { AuthPage } from '@/features/auth/AuthPages';
import { OnboardingPage } from '@/features/onboarding/OnboardingPage';
import { applyTheme, useUI } from '@/store/ui';
import { useAuth } from '@/store/auth';
import { usePwaUpdate } from '@/lib/pwa';
import { bootstrapUser, clearWorkspace, currentWorkspaceUserId } from '@/bootstrap';

const EditorPage = lazy(() => import('@/features/editor/EditorPage').then((m) => ({ default: m.EditorPage })));
const RecapPage = lazy(() => import('@/features/recap/RecapPage').then((m) => ({ default: m.RecapPage })));

function ProtectedGate() {
  const { status, session, profile } = useAuth();
  const location = useLocation();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (status !== 'authenticated' || !session) {
      void clearWorkspace();
      setReady(false);
      return;
    }
    if (currentWorkspaceUserId() === session.user.id) {
      setReady(true);
      return;
    }
    setReady(false);
    bootstrapUser(session.user.id)
      .then(() => live && setReady(true))
      .catch((err) => live && setFailed(err instanceof Error ? err.message : 'Initialisation impossible.'));
    return () => { live = false; };
  }, [status, session?.user.id]);

  if (status === 'loading') return <div className="editor-loading" aria-busy="true">Connexion à LexNote…</div>;
  if (status !== 'authenticated' || !session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (failed) return <div className="auth"><div className="auth__card" role="alert"><h1>Impossible d’ouvrir votre espace</h1><p>{failed}</p><button className="btn btn--primary" onClick={() => window.location.reload()}>Réessayer</button></div></div>;
  if (!ready) return <div className="editor-loading" aria-busy="true">Synchronisation de votre espace…</div>;
  if (profile && !profile.onboardingCompleted) return <OnboardingPage />;
  return <Outlet />;
}

export function App() {
  const theme = useUI((s) => s.theme);
  usePwaUpdate();

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
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
            <Route path="/reset-password" element={<AuthPage mode="reset" />} />

            <Route element={<ProtectedGate />}>
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
            </Route>
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