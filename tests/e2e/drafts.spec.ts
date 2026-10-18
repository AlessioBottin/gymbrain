import { test, expect } from '@playwright/test';
test('Draft survives Escape and reopening; padding cannot dismiss the editor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Prova sul dispositivo' }).click();
  await page.getByRole('button', { name: 'Esercizi', exact: true }).click();
  await page.getByRole('button', { name: 'Nuovo esercizio' }).click();
  const dialog = page.getByRole('dialog', { name: 'UN NUOVO INIZIO' });
  await dialog.getByLabel('Nome', { exact: true }).fill('Bozza resistente');
  await dialog.getByLabel('Note generali').fill('Queste note non devono sparire');
  await dialog.click({ position: { x: 3, y: 3 } });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Nuovo esercizio' }).click();
  await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('Bozza resistente');
  await expect(dialog.getByLabel('Note generali')).toHaveValue('Queste note non devono sparire');
  await dialog.getByRole('button', { name: 'Salva sul dispositivo' }).click();
  await page.getByRole('button', { name: 'Nuovo esercizio' }).click();
  await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('');
});
test('Slow decimal input survives timer ticks, persists on commit, mobile session remains centered', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Prova sul dispositivo' }).click();
  await page.getByRole('button', { name: 'Usa percorso iniziale' }).click();
  await page.getByRole('button', { name: 'Avvia' }).click();
  const dialog = page.getByRole('dialog', { name: /FOCUS MODE/ }),
    load = dialog.getByRole('textbox', { name: 'Serie 1 load', exact: true });
  await load.fill('12,');
  await page.waitForTimeout(1500);
  await expect(load).toHaveValue('12,');
  await load.pressSequentially('5', { delay: 100 });
  await load.press('Tab');
  await expect(load).toHaveValue('12,5');
  await dialog.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await page.getByRole('button', { name: 'Riprendi sessione' }).click();
  await expect(load).toHaveValue('12,5');
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'preview-artifacts/greek-session-mobile.png', fullPage: true });
});
