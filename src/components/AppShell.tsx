import { useMemo } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { BookOpen, FolderTree, Home, Library, Plus, Search, Settings, Command } from 'lucide-react';
import { LogoMark } from './Logo';
import { SubjectDot } from './SubjectDot';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { modKeyLabel } from '@/features/editor/commands';

const navClass = ({ isActive }: { isActive: boolean }) => `nav__item${isActive ? ' is-active' : ''}`;

export function AppShell() {
  const subjects = useLibrary((s) => s.subjects);
  const sessions = useLibrary((s) => s.sessions);
  const persistent = useLibrary((s) => s.persistent);
  const { openNewCm, setPalette } = useUI();

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    sessions.forEach((s) => m.set(s.subjectId, (m.get(s.subjectId) ?? 0) + 1));
    return m;
  }, [sessions]);
  const sorted = useMemo(() => [...subjects].sort((a, b) => a.name.localeCompare(b.name, 'fr')), [subjects]);

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="brand">
          <LogoMark className="brand__mark" />
          LexNote
        </div>

        <button className="btn btn--primary" onClick={() => openNewCm()} data-testid="new-cm">
          <Plus /> Nouveau CM
        </button>

        <nav className="nav" aria-label="Sections">
          <NavLink to="/" end className={navClass}><Home /> Accueil</NavLink>
          <NavLink to="/subjects" className={navClass}><FolderTree /> Mes matières</NavLink>
          <NavLink to="/sessions" className={navClass}><Library /> Mes CM</NavLink>
          <NavLink to="/search" className={navClass}><Search /> Recherche</NavLink>
          <button className="nav__item" style={{ background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setPalette(true)}>
            <Command /> Commandes <kbd className="kbd-hint">{modKeyLabel} K</kbd>
          </button>
        </nav>

        <div className="sidebar__section">
          <div className="sidebar__title">Matières</div>
          {sorted.length === 0 && <p className="muted" style={{ padding: '0 10px', fontSize: 13 }}>Aucune matière pour l’instant.</p>}
          {sorted.map((s) => (
            <NavLink key={s.id} to={`/subjects/${s.id}`} className={(p) => `${navClass(p)} subject-link`}>
              <SubjectDot color={s.color} />
              <span className="truncate">{s.name}</span>
              <span className="count">{counts.get(s.id) ?? 0}</span>
            </NavLink>
          ))}
        </div>

        <div className="sidebar__foot">
          <div className="sidebar__sync" title="Vos notes restent sur cet appareil. Aucune donnée n’est envoyée.">
            <BookOpen size={14} />
            {persistent ? 'Stockage local · hors ligne' : 'Stockage temporaire !'}
          </div>
          <NavLink to="/settings" className={navClass}><Settings /> Réglages</NavLink>
        </div>
      </aside>

      <main className="main" id="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Navigation mobile">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'is-active' : '')}><Home />Accueil</NavLink>
        <NavLink to="/subjects" className={({ isActive }) => (isActive ? 'is-active' : '')}><FolderTree />Matières</NavLink>
        <NavLink to="/sessions" className={({ isActive }) => (isActive ? 'is-active' : '')}><Library />CM</NavLink>
        <NavLink to="/search" className={({ isActive }) => (isActive ? 'is-active' : '')}><Search />Recherche</NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'is-active' : '')}><Settings />Réglages</NavLink>
      </nav>
    </div>
  );
}
