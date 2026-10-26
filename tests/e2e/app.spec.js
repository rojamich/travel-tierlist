import { test, expect } from '@playwright/test';

async function add(page, name = 'Japan') {
  await page.locator('#page-board [data-action="add"]').first().click();
  await page.locator('#destination-name').fill(name);
}
async function score(page, value) {
  for (const key of ['wonder', 'things', 'food', 'transportation', 'safety'])
    await page.locator(`#score-${key}`).selectOption(String(value));
}
async function save(page) {
  await page.locator('#save-destination').click();
  await expect(page.locator('#country-dialog')).not.toBeVisible();
}
async function edit(page, name = 'Japan') {
  await page
    .getByRole('button', { name: `Edit ${name}`, exact: true })
    .first()
    .click();
}

test('both profiles save, expected and experienced ratings stay separate, and data survives reload', async ({
  page,
}) => {
  await page.goto('/');
  await add(page);
  await score(page, 4);
  await page.locator('#profile-notes').fill('Mike’s first impression');
  await page.locator('[data-profile="jen"]').click();
  await score(page, 5);
  await page.locator('#profile-notes').fill('Jen’s first impression');
  await save(page);
  await page.reload();
  await edit(page);
  await expect(page.locator('#profile-notes')).toHaveValue('Mike’s first impression');
  await expect(page.locator('#score-food')).toHaveValue('4');
  await page.locator('[data-profile="jen"]').click();
  await expect(page.locator('#profile-notes')).toHaveValue('Jen’s first impression');
  await page.locator('[data-phase="experienced"]').click();
  await expect(page.locator('#score-food')).toHaveValue('');
  await score(page, 2);
  await save(page);
  await edit(page);
  await page.locator('[data-profile="jen"]').click();
  await expect(page.locator('#score-food')).toHaveValue('5');
});
test('all Not scored values clear the old rating', async ({ page }) => {
  await page.goto('/');
  await add(page);
  await score(page, 5);
  await save(page);
  await edit(page);
  for (const key of ['wonder', 'things', 'food', 'transportation', 'safety'])
    await page.locator(`#score-${key}`).selectOption('');
  await save(page);
  await expect(
    page.locator('.tier-unranked').getByRole('button', { name: 'Edit Japan' }),
  ).toBeVisible();
  await edit(page);
  await expect(page.locator('#score-food')).toHaveValue('');
});
test('neither-rated destinations are available in both rank-next queues', async ({ page }) => {
  await page.goto('/');
  await add(page, 'Antarctica');
  await save(page);
  await expect(page.locator('#queue-actions [data-profile-key="mike"]')).toContainText(
    '1 still to rate',
  );
  await expect(page.locator('#queue-actions [data-profile-key="jen"]')).toContainText(
    '1 still to rate',
  );
  await page.locator('#queue-actions [data-profile-key="jen"]').click();
  await expect(page.locator('[data-profile="jen"]')).toHaveAttribute('aria-pressed', 'true');
});
test('unsaved edits are recoverable after closing and reopening the app', async ({ page }) => {
  await page.goto('/');
  await add(page, 'Svalbard');
  await page.locator('#profile-notes').fill('Remember the fjords');
  await page.locator('#close-editor').click();
  await page.reload();
  await page.locator('#resume-draft').click();
  await expect(page.locator('#destination-name')).toHaveValue('Svalbard');
  await expect(page.locator('#profile-notes')).toHaveValue('Remember the fjords');
  await save(page);
});
test('deletion and rating reset can be restored from recovery', async ({ page }) => {
  await page.goto('/');
  await add(page);
  await score(page, 4);
  await page.locator('#profile-notes').fill('Keep this note');
  await save(page);
  await edit(page);
  await page.locator('#reset-destination').click();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('#score-food')).toHaveValue('');
  await expect(page.locator('#profile-notes')).toHaveValue('Keep this note');
  await page.locator('#delete-destination').click();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('#country-dialog')).not.toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.locator('[data-action="restore"]').first().click();
  await page.locator('#confirm-accept').click();
  await page.getByRole('link', { name: 'Tier board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Japan', exact: true })).toBeVisible();
});
test('backups export and import custom destinations and couple budgets', async ({ page }) => {
  await page.goto('/');
  await add(page, 'Antarctica');
  await page.locator('#budget-amount').fill('12000');
  await page.locator('#budget-basis').selectOption('couple');
  await page.locator('#budget-duration').fill('14');
  await save(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.locator('#export-backup').click();
  const file = await download;
  await page.locator('#import-backup').setInputFiles(await file.path());
  await expect(page.locator('#import-summary')).toContainText('1 destinations');
  await page.locator('#import-form button[type="submit"]').click();
  await page.getByRole('link', { name: 'Destinations', exact: true }).click();
  await expect(page.locator('#country-cards')).toContainText('both of us / 14 days');
});
test('photo errors retain saved images and late responses cannot change another destination', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.locator('#pexels-key').fill('test-key');
  await page.locator('#photo-settings button').click();
  let respond;
  await page.route('https://api.pexels.com/**', async (route) => {
    await new Promise((resolve) => {
      respond = resolve;
    });
    await route
      .fulfill({
        json: {
          photos: [
            {
              src: { landscape: 'https://images.pexels.com/test-photo.jpg' },
              url: 'https://pexels.com/test',
              alt: 'Japan photo',
              photographer: 'Test',
            },
          ],
        },
      })
      .catch(() => {});
  });
  await page.getByRole('link', { name: 'Tier board', exact: true }).click();
  await add(page);
  await save(page);
  await add(page, 'Italy');
  await save(page);
  await edit(page);
  await page.getByText('Attraction gallery', { exact: true }).click();
  await page.locator('#regenerate-photos').click();
  await expect.poll(() => Boolean(respond)).toBe(true);
  await page.locator('#close-editor').click();
  await edit(page, 'Italy');
  respond();
  await page.getByText('Attraction gallery', { exact: true }).click();
  await expect(page.locator('#photo-gallery figure')).toHaveCount(0);
});
test('malformed backup is rejected without replacing the existing list', async ({ page }) => {
  await page.goto('/');
  await add(page);
  await save(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.locator('#import-backup').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"oops":true}'),
  });
  await expect(page.locator('#toast')).toContainText('Travel Tiers JSON');
  await page.getByRole('link', { name: 'Tier board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Japan', exact: true })).toBeVisible();
});
test('offline app shell and saved ratings reload without a connection', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await add(page, 'Vietnam');
  await score(page, 5);
  await save(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit Vietnam', exact: true })).toBeVisible();
  await edit(page, 'Vietnam');
  await expect(page.locator('#score-food')).toHaveValue('5');
});
test('phone layout has no horizontal overflow and interactive pills support keyboards', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await add(page, 'Bosnia and Herzegovina');
  await score(page, 4);
  await save(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const pill = page.getByRole('button', { name: 'Edit Bosnia and Herzegovina', exact: true });
  await pill.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#country-dialog')).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: `test-results/editor-${test.info().project.name}.png` });
});

test('random discovery and tier-only presentation remain available', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto('/');
  await add(page);
  await page.locator('#random-country').click();
  await expect(page.locator('#destination-name')).toHaveValue('Afghanistan');
  await save(page);
  await page.locator('#toggle-tier-only').click();
  await expect(page.locator('.app-header')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Afghanistan', exact: true })).toBeVisible();
  await page.locator('#exit-tier-only').click();
  await expect(page.locator('.app-header')).toBeVisible();
});

test('destination lifecycle starts with Idea and preserves ratings through Planned, Visited and Revisit', async ({
  page,
}) => {
  await page.goto('/');
  await add(page);
  await expect(page.locator('#destination-status')).toHaveValue('idea');
  await expect(page.locator('#status-help')).toContainText('Just an idea');
  await score(page, 3);
  await page.locator('#destination-status').selectOption('planned');
  await save(page);
  await edit(page);
  await expect(page.locator('#score-food')).toHaveValue('3');
  await page.locator('#destination-status').selectOption('visited');
  await score(page, 5);
  await save(page);
  await edit(page);
  await expect(page.locator('#score-food')).toHaveValue('5');
  await page.locator('#destination-status').selectOption('revisit');
  await save(page);
  await page.reload();
  await edit(page);
  await expect(page.locator('#destination-status')).toHaveValue('revisit');
  await expect(page.locator('#score-food')).toHaveValue('5');
  await page.locator('[data-phase="expected"]').click();
  await expect(page.locator('#score-food')).toHaveValue('3');
});

test('completed destinations open reports automatically with both people and before/after changes', async ({
  page,
}) => {
  await page.goto('/');
  await add(page);
  await score(page, 3);
  await page.locator('#profile-pre-notes').fill('Expected great food');
  await page.locator('[data-phase="experienced"]').click();
  await score(page, 5);
  await page.locator('#profile-post-notes').fill('Even better in person');
  await page.locator('[data-profile="jen"]').click();
  await score(page, 4);
  await page.locator('[data-phase="expected"]').click();
  await score(page, 5);
  await page.locator('#destination-status').selectOption('visited');
  await save(page);
  await page.getByRole('button', { name: 'Report for Japan', exact: true }).click();
  await expect(page.locator('#report-dialog')).toBeVisible();
  await expect(page.locator('#edit-report')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#report-body')).toContainText('Both perspectives');
  await expect(page.locator('.report-summary')).toContainText('22.5 / 25');
  await expect(page.locator('.report-summary')).toContainText('+2.5');
  await expect(page.locator('.person-report.mike')).toContainText('+10');
  await expect(page.locator('.person-report.jen')).toContainText('−5');
  await expect(page.locator('#report-body')).toContainText('Expected great food');
  await expect(page.locator('#report-body')).toContainText('Even better in person');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/trip-report-${test.info().project.name}.png` });
  await page.locator('#edit-report').click();
  await expect(page.locator('#country-dialog')).toBeVisible();
  await page.locator('#destination-status').selectOption('revisit');
  await save(page);
  await page.getByRole('button', { name: 'Report for Japan', exact: true }).click();
  await expect(page.locator('#report-body')).toContainText('Revisit');
  await page.locator('#close-report').click();
  await expect(page.locator('#report-dialog')).not.toBeVisible();
});

test('partial reports show missing ratings and link straight to the correct person and phase', async ({
  page,
}) => {
  await page.goto('/');
  await add(page);
  await score(page, 4);
  await save(page);
  await page.getByRole('link', { name: 'Destinations', exact: true }).click();
  await page.getByRole('button', { name: 'Compare ratings', exact: true }).click();
  await expect(page.locator('#report-body')).toContainText('Report in progress');
  await expect(page.locator('.report-summary')).toContainText('1/2 rated');
  await expect(page.locator('.person-report.jen')).not.toContainText('0 / 25');
  await page
    .locator('[data-action="report-rate"][data-profile-key="jen"][data-phase-key="experienced"]')
    .click();
  await expect(page.locator('[data-profile="jen"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-phase="experienced"]')).toHaveAttribute('aria-pressed', 'true');
});

test('async buttons show waiting, reject duplicate clicks, and restore on success and failure', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.locator('#pexels-key').fill('test-key');
  await page.locator('#photo-settings button').click();
  await expect(page.locator('#toast')).toContainText('Photo key saved');
  let release;
  let requests = 0;
  await page.route('https://api.pexels.com/**', async (route) => {
    requests++;
    await new Promise((resolve) => {
      release = resolve;
    });
    await route.fulfill({ status: 500, body: 'Failed' });
  });
  await page.getByRole('link', { name: 'Tier board', exact: true }).click();
  await add(page);
  await page.getByText('Attraction gallery', { exact: true }).click();
  await page.locator('#regenerate-photos').click();
  await expect(page.locator('#regenerate-photos')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#regenerate-photos')).toHaveText('Finding photos…');
  await expect(page.locator('#regenerate-photos')).toBeDisabled();
  await expect.poll(() => Boolean(release)).toBe(true);
  expect(requests).toBe(1);
  release();
  await expect(page.locator('#regenerate-photos')).toBeEnabled();
  await expect(page.locator('#regenerate-photos')).toHaveText('Find photos');
  await expect(page.locator('#photo-status')).toContainText('existing photos');
  await page.locator('#clear-profile-scores').click();
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#country-dialog #toast')).toContainText('draft');
});

async function seedConflict(page, identical) {
  await page.evaluate(async (identical) => {
    const request = indexedDB.open('travel-tiers', 1);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('state', 'readwrite');
    const bucket = transaction.objectStore('state');
    const get = bucket.get('travel-tiers-v3');
    get.onsuccess = () => {
      const state = get.result;
      const operation = Object.values(state.pending).find((op) => op.kind === 'meta');
      const data = structuredClone(operation.data);
      if (!identical) data.manualTier = 'S';
      operation.conflict = { reason: 'changed', remote: { data, revision: 'other-revision' } };
      bucket.put(state, 'travel-tiers-v3');
    };
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, identical);
  await page.reload();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
}

test('identical persisted sync conflicts disappear without asking the user to choose', async ({
  page,
}) => {
  await page.goto('/');
  await add(page);
  await save(page);
  await seedConflict(page, true);
  await expect(page.locator('.conflict-row')).toHaveCount(0);
  await expect(page.locator('#connection-label')).not.toContainText('review');
});

test('real conflicts show only changed fields and resolving them gives feedback', async ({
  page,
}) => {
  await page.goto('/');
  await add(page);
  await save(page);
  await seedConflict(page, false);
  await expect(page.locator('.conflict-row')).toContainText('1 changed field');
  await expect(page.locator('.conflict-changes')).toContainText('Manual tier');
  await expect(page.locator('.conflict-changes')).toContainText('This device: Automatic');
  await expect(page.locator('.conflict-changes')).toContainText('Shared list: S');
  await expect(page.locator('.conflict-changes')).not.toContainText('Photo count');
  await page.locator('[data-action="conflict-remote"]').click();
  await expect(page.locator('.conflict-row')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('Shared version kept');
  await page.screenshot({ path: `test-results/conflict-resolved-${test.info().project.name}.png` });
});
