const { test, expect } = require('@playwright/test');

const base = process.env.E2E_BASE_URL;
const email = process.env.E2E_STUDENT_EMAIL;
const password = process.env.E2E_STUDENT_PASSWORD;

test.describe('AH Student Hub — critical student path', () => {
  test.skip(!base || !email || !password, 'Set E2E_BASE_URL, E2E_STUDENT_EMAIL and E2E_STUDENT_PASSWORD for the live staging run.');

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => { throw new Error(`Browser page error: ${err.message}`); });
    page.on('console', msg => {
      if (msg.type() === 'error') throw new Error(`Browser console error: ${msg.text()}`);
    });
  });

  test('source routes resolve without 404', async ({ request }) => {
    for (const path of ['/apply.html#signin', '/student-login.html', '/portal.html', '/forgot-password.html']) {
      const r = await request.get(new URL(path, base).toString());
      expect(r.status(), path).toBe(200);
    }
  });

  test('student login renders the application immediately', async ({ page }) => {
    await page.goto(new URL('/apply.html#signin', base).toString(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.locator('#content')).toBeVisible();
    await expect(page.locator('#content')).not.toBeEmpty();
    await expect(page.locator('#chipP')).toBeVisible();
    await expect(page.locator('#gear')).toBeVisible();
  });

  test('wizard Continue and Back move between permitted stages', async ({ page }) => {
    await page.goto(new URL('/apply.html#signin', base).toString(), { waitUntil: 'networkidle' });
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    const wizard = page.locator('.wz');
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('li.on')).toContainText(/Intake|Your Details|Category|Courses|Payment|Preview|Confirm|Status/i);

    const next = page.locator('#nx');
    if (await next.count()) {
      const before = await wizard.locator('li.on').innerText();
      await next.click();
      const after = await wizard.locator('li.on').innerText();
      expect(after).not.toBe(before);

      const back = page.locator('#bk');
      await expect(back).toBeEnabled();
      await back.click();
      await expect(wizard.locator('li.on')).toContainText(before);
    }
  });

  test('student can sign out and session does not persist', async ({ page }) => {
    await page.goto(new URL('/apply.html#signin', base).toString(), { waitUntil: 'networkidle' });
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('#content')).toBeVisible();

    const settings = page.locator('#gear');
    await settings.click();
    const signOut = page.getByRole('button', { name: /sign out/i });
    if (await signOut.count()) {
      await signOut.click();
      await expect(page).toHaveURL(/apply\.html#signin|student-login\.html/i);
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
    }
  });
});
