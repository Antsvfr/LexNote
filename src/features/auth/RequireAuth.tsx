import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Splash } from '@/components/Splash';
import { useAuth } from '@/store/auth';
import { useLibrary } from '@/store/library';

/**
 * Garde de toutes les routes privées. Rien de l'application n'est rendu tant que
 * l'identité ET l'espace de travail de cet utilisateur ne sont pas prêts.
 */
export function RequireAuth() {
  const { status, workspace, workspaceError, profile, profileReady, recovering } = useAuth();
  const loaded = useLibrary((s) => s.ready);
  const subjects = useLibrary((s) => s.subjects.length);
  const sessions = useLibrary((s) => s.sessions.length);
  const loc = useLocation();

  if (status === 'loading') return <Splash />;
  if (status === 'unconfigured' || status === 'unauthenticated') return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (recovering) return <Navigate to="/reset-password" replace />;
  if (workspace === 'error') {
    return (
      <div className="authpage"><div className="authpage__col"><main className="authcard" role="alert">
        <h1>Espace de travail inaccessible</h1>
        <p className="authcard__sub">{workspaceError ?? 'Le stockage local est inaccessible.'} Rechargez la page ; si le problème persiste, vérifiez que le navigateur autorise le stockage de données.</p>
      </main></div></div>
    );
  }
  if (workspace !== 'ready' || !loaded || !profileReady) return <Splash label="Ouverture de votre espace…" />;
  const empty = subjects === 0 && sessions === 0;
  if (profile && !profile.onboardingCompleted && empty && loc.pathname !== '/onboarding') return <Navigate key={loc.pathname} to="/onboarding" replace />;
  return <Outlet />;
}
