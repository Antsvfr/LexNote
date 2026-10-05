import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/newsreader/wght.css';
import '@fontsource-variable/newsreader/wght-italic.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/layout.css';
import './styles/pages.css';
import './styles/editor.css';
import './styles/capture.css';
import { App } from './App';
import { bootstrap } from './bootstrap';

const root = createRoot(document.getElementById('root')!);

bootstrap()
  .then(() => root.render(<StrictMode><App /></StrictMode>))
  .catch((err) => {
    console.error('[LexNote] Démarrage impossible', err);
    root.render(
      <div className="page" role="alert">
        <h1>LexNote n’a pas pu démarrer</h1>
        <p className="page__sub">Le stockage local est inaccessible. Rechargez la page ; si le problème persiste, vérifiez que le navigateur autorise le stockage de données.</p>
      </div>,
    );
  });
