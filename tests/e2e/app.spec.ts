import { test, expect } from '@playwright/test'
test('Chrome desktop: create a plan, log a session, reload offline and finish with a substitution', async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Prova sul dispositivo' }).click()
  await page.getByRole('button', { name: 'Usa percorso iniziale' }).click()
  await expect(page.getByRole('heading', { name: 'Forza, sotto controllo.' })).toBeVisible()
  await page.screenshot({
    path: 'preview-artifacts/app-desktop.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.getByRole('button', { name: 'Avvia' }).click()
  const session = page.getByRole('dialog', { name: 'FOCUS MODE · IL TUO ALLENAMENTO', exact: true })
  await session.getByRole('textbox', { name: 'Serie 1 reps', exact: true }).fill('6')
  await session.getByRole('textbox', { name: 'Serie 1 load', exact: true }).fill('12.5')
  await session.getByRole('textbox', { name: 'Serie 1 rpe', exact: true }).fill('8')
  await session.getByRole('textbox', { name: 'Serie 1 rir', exact: true }).fill('2')
  await session.getByRole('button', { name: 'Completa serie 1', exact: true }).click()
  await expect(session.getByRole('button', { name: 'Riapri serie 1', exact: true })).toBeVisible()
  await expect(session.getByText('Progressi salvati', { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: 'Riprendi sessione' }).click()
  await expect(session.getByRole('textbox', { name: 'Serie 1 load', exact: true })).toHaveValue(
    '12,5',
  )
  await expect(session.getByRole('button', { name: 'Riapri serie 1', exact: true })).toBeVisible()
  await session.getByRole('button', { name: '2. Dip alle parallele' }).click()
  await session.getByRole('button', { name: 'Sostituisci' }).click()
  const swap = page.getByRole('dialog', { name: 'UN’ALTERNATIVA PER OGGI' })
  await swap
    .getByRole('combobox', { name: 'Sostituzione', exact: true })
    .selectOption({ label: 'Pull-up' })
  await swap.getByLabel('Motivo / note').fill('Parallele occupate')
  await swap.getByRole('button', { name: 'Applica sostituzione' }).click()
  await session.getByLabel('GORNATION Ultra Light').check()
  await session.getByLabel('Banda e configurazione').fill('Banda verde, singola')
  await session.getByRole('textbox', { name: 'Serie 1 reps', exact: true }).fill('8')
  await session.getByRole('button', { name: 'Completa serie 1', exact: true }).click()
  await session.getByRole('button', { name: 'Concludi', exact: true }).click()
  await page.getByRole('button', { name: 'Salva allenamento', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Il lavoro si vede.' })).toBeVisible()
  await page.getByRole('button', { name: /Upper body.*Dettagli/ }).click()
  await expect(page.getByRole('dialog', { name: 'OGNI SERIE HA UNA STORIA' })).toContainText(
    'Parallele occupate',
  )
  expect(errors).toEqual([])
})
test('Chrome mobile: library creation, prescription editing, responsive layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Prova sul dispositivo' }).click()
  await page.getByRole('button', { name: 'Usa percorso iniziale' }).click()
  await expect(page.getByRole('heading', { name: 'Forza, sotto controllo.' })).toBeVisible()
  await page.screenshot({
    path: 'preview-artifacts/app-mobile.png',
    fullPage: true,
    animations: 'disabled',
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('button', { name: 'Esercizi', exact: true }).click()
  await page.getByRole('button', { name: 'Nuovo esercizio' }).click()
  const editor = page.getByRole('dialog', { name: 'UN NUOVO INIZIO' })
  await expect(editor.getByRole('radio', { name: 'Corpo libero', exact: true })).toBeChecked()
  await editor.getByText('Pesi', { exact: true }).click()
  await expect(editor.getByRole('radio', { name: 'Pesi', exact: true })).toBeChecked()
  await editor.getByText('Corpo libero', { exact: true }).click()
  await editor.getByLabel('Nome', { exact: true }).fill('HSPU')
  await editor.getByLabel('Descrizione').fill('Spinta verticale')
  await editor.getByLabel('Note generali').fill('Controllo in verticale')
  await editor.getByRole('button', { name: 'Aggiungi variante +' }).click()
  const variantEditor = page.getByRole('dialog', { name: 'VARIANTE DEL MOVIMENTO', exact: true })
  await variantEditor.getByLabel('Nome variante').fill('Deep')
  await variantEditor.getByLabel('Note variante').fill('Discesa profonda sulle parallettes')
  await variantEditor.getByRole('button', { name: 'Conferma variante', exact: true }).click()
  await editor.getByRole('button', { name: 'Salva', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'HSPU' })).toBeVisible()
  await page.getByRole('button', { name: 'Percorso', exact: true }).click()
  await page.getByRole('button', { name: 'Modifica giornata' }).click()
  const workout = page.getByRole('dialog', { name: 'PERSONALIZZA IL TUO PERCORSO' })
  await workout.getByLabel('Aggiungi dal tuo catalogo').selectOption({ label: 'HSPU' })
  await workout.getByRole('button', { name: 'Aggiungi +', exact: true }).click()
  await workout.getByLabel('Variante del movimento').last().selectOption({ label: 'Deep' })
  await workout
    .getByRole('checkbox', { name: /GORNATION Ultra Light/ })
    .last()
    .check()
  await workout.getByLabel('HSPU serie 1 target load', { exact: true }).fill('5')
  await workout.getByLabel('Note specifiche per questa scheda').last().fill('Esecuzione esplosiva')
  await workout.getByRole('button', { name: 'Salva', exact: true }).click()
  await expect(page.getByText('Esecuzione esplosiva', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Il peso, in sintonia.' })).toBeVisible()
  await expect(
    page.getByText('Accedi con il tuo account Gymbrain per collegare la bilancia.'),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
