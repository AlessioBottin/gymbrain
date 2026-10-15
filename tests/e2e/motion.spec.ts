import { test, expect } from '@playwright/test';

test('Glass panels reveal again when scrolling down and back up', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Prova sul dispositivo' }).click();
  await page.getByRole('button', { name: 'Usa percorso iniziale' }).click();
  const panel = page.locator('#content .hero').first();
  await expect(panel.getByRole('heading', { name: 'Forza, sotto controllo.' })).toBeVisible();
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toHaveClass(/is-revealed/);
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await expect(panel).not.toHaveClass(/is-revealed/);
  await expect(panel).toHaveCSS('--reveal-offset', '-28px');
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toHaveClass(/is-revealed/);
  await expect(panel).toHaveCSS('opacity', '1');
  const lowerPanel = page.locator('#content .panel').first();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(lowerPanel).not.toHaveClass(/is-revealed/);
  await expect(lowerPanel).toHaveCSS('--reveal-offset', '28px');
  await lowerPanel.scrollIntoViewIfNeeded();
  await expect(lowerPanel).toHaveClass(/is-revealed/);
  await expect(lowerPanel).toHaveCSS('opacity', '1');
});

test('Marble background and scroll reveals remain accessible with reduced motion', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Prova sul dispositivo' }).click();
  await page.getByRole('button', { name: 'Usa percorso iniziale' }).click();
  await expect(page.locator('.marble-sculpture')).toHaveAttribute('aria-hidden', 'true');
  const panel = page.locator('#content .panel').last();
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toHaveClass(/is-revealed/);
  await expect(panel).toHaveCSS('opacity', '1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Esercizi', exact: true }).click();
  await page.getByRole('button', { name: 'Nuovo esercizio' }).click();
  await expect(page.getByRole('dialog')).toHaveCSS('animation-name', 'none');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Oggi', exact: true }).click();
  await page.screenshot({ path: 'preview-artifacts/greek-immersive-desktop.png', fullPage: true });
});
