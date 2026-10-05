import { defineConfig, devices } from '@playwright/test';

const chromiumPath = process.env.CHROMIUM_PATH || undefined;
/** Par défaut : Chromium seul. `ALL_BROWSERS=1` ajoute Firefox et WebKit (à installer : `npx playwright install firefox webkit`). */
const all = process.env.ALL_BROWSERS === '1';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', serviceWorkers: 'allow' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          executablePath: chromiumPath,
          // Micro simulé (bip) : permet de tester le vrai MediaRecorder sans matériel.
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
    ...(all
      ? [
          // Firefox / WebKit : parcours V1 + non-régression. Le micro simulé n'y est pas disponible : les tests « mic » sont réservés à Chromium.
          { name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } } } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !!process.env.REUSE_SERVER, // jamais de serveur périmé par défaut : le build est refait à chaque exécution
    timeout: 120_000,
  },
});
