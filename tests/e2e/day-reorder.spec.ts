import { test, expect } from '@playwright/test';

test('Dragging days persists their order and keeps prescriptions on their day', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Prova sul dispositivo' }).click();
  await page.getByRole('button', { name: 'Usa percorso iniziale' }).click();
  await page.getByRole('button', { name: 'Percorso', exact: true }).click();
  const open = page.getByRole('button', { name: 'Apri builder scheda' });
  await open.click();
  const builder = page.getByRole('dialog', { name: 'BUILDER DELLA SCHEDA', exact: true });
  const days = builder.locator('.builder-day');
  const names = builder.locator('.builder-day-name input');
  await expect(days.first()).toContainText('Sovraccarico: 10 kg');
  await expect(days.nth(1)).toContainText('Carico: 60 kg');
  await expect(days.last()).toContainText('Elastico: Assistenza media');
  await builder
    .getByRole('button', { name: 'Riordina giornata Upper body', exact: true })
    .dragTo(days.last().locator('.builder-day-heading'));
  await expect(names.first()).toHaveValue('Lower body');
  await expect(names.last()).toHaveValue('Upper body');
  await expect(days.last()).toContainText('Sovraccarico: 10 kg');
  await expect(builder.locator('.draft-status[role=status]')).toHaveText('Modifiche salvate');
  await builder.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Percorso', exact: true }).click();
  await open.click();
  await expect(names.first()).toHaveValue('Lower body');
  await expect(names.last()).toHaveValue('Upper body');
  await builder.getByRole('button', { name: 'Riordina giornata Upper body', exact: true }).press('ArrowLeft');
  await expect(names.nth(1)).toHaveValue('Upper body');
  await expect(builder.locator('.draft-status[role=status]')).toHaveText('Modifiche salvate');
  await page.screenshot({ path: 'preview-artifacts/day-reorder.png' });
});
