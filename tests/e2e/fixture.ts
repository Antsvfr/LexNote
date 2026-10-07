import { test as base, expect } from '@playwright/test';

export const E2E_USER_ID = '33333333-3333-4333-8333-333333333333';
const SUPABASE_ORIGIN = 'https://ylggagkweyzorhjbihyq.supabase.co';

const SESSION = {
  access_token: 'e2e.header.e2e-signature',
  refresh_token: 'e2e-refresh-token',
  expires_in: 3600,
  expires_at: 4102444800,
  token_type: 'bearer',
  user: { id: E2E_USER_ID, email: 'e2e@lexnote.test', user_metadata: { first_name: '' } },
};

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(SUPABASE_ORIGIN + '/**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();

      if (url.pathname === '/rest/v1/profiles' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{
            id: E2E_USER_ID,
            email: 'e2e@lexnote.test',
            first_name: '',
            last_name: '',
            avatar_url: null,
            institution: '',
            academic_year: '',
            quote: 'Comprendre aujourd’hui, maîtriser demain.',
            onboarding_completed: true,
          }]),
        });
        return;
      }

      if (method === 'GET' && url.pathname.startsWith('/rest/v1/')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        return;
      }

      if (url.pathname === '/auth/v1/logout' || url.pathname === '/functions/v1/delete-account') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        return;
      }

      if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
        await route.fulfill({ status: 204, body: '' });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.addInitScript((session) => {
      localStorage.setItem('lexnote.auth.session', JSON.stringify(session));
    }, SESSION);

    await use(page);
  },
});

export { expect };
