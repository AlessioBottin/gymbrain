import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
test('real account: sync to the shared database, expired-login offline cache, reconnect', async ({
  page,
  context,
}) => {
  test.skip(process.env.RUN_LIVE_TESTS !== 'yes', 'Explicit opt-in live test only')
  test.setTimeout(90000)
  const run = crypto.randomUUID(),
    password = crypto.randomUUID() + 'Gt!9',
    email = `gymbrain-browser-${run}@example.com`
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { gymbrain_test_run: run },
  })
  if (error) throw error
  try {
    await page.goto('/')
    if(process.env.EXPECT_PRODUCTION==='yes') await expect(page.getByRole('button',{name:'Prova sul dispositivo'})).not.toBeVisible()
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Entra nel tuo spazio' }).click()
    await page.getByRole('button', { name: 'Esercizi', exact: true }).click()
    await page.getByRole('button', { name: 'Nuovo esercizio' }).click()
    await page.getByRole('dialog').getByLabel('Nome', { exact: true }).fill('Cloud pull-up')
    await page.getByRole('button', { name: 'Salva sul dispositivo' }).click()
    await expect
      .poll(
        async () => {
          const r = await admin.from('training_records').select('id').eq('user_id', data.user.id)
          return r.data?.length
        },
        { timeout: 45000 },
      )
      .toBe(1)
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
      if (key) {
        const token = JSON.parse(localStorage.getItem(key)!)
        token.expires_at = 1
        localStorage.setItem(key, JSON.stringify(token))
      }
    })
    await context.setOffline(true)
    await page.reload()
    await page.getByRole('button', { name: 'Esercizi', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Cloud pull-up', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Modifica Cloud pull-up', exact: true }).click()
    await page.getByRole('dialog').getByLabel('Note generali').fill('Registrato offline con login scaduto')
    await page.getByRole('button', { name: 'Salva sul dispositivo' }).click()
    await page.reload()
    await page.getByRole('button', { name: 'Esercizi', exact: true }).click()
    await expect(page.getByText('Registrato offline con login scaduto', { exact: true })).toBeVisible()
    await context.setOffline(false)
    await page.getByRole('button', { name: 'Account', exact: true }).click()
    await page.getByRole('button', { name: 'Sincronizza ora', exact: true }).click()
    await expect
      .poll(
        async () => {
          const r = await admin.from('training_records').select('payload').eq('user_id', data.user.id)
          return r.data?.[0]?.payload?.notes
        },
        { timeout: 30000 },
      )
      .toBe('Registrato offline con login scaduto')
  } finally {
    const checked = await admin.auth.admin.getUserById(data.user.id)
    if (checked.data.user?.app_metadata.gymbrain_test_run !== run) throw new Error('Cleanup owner mismatch')
    const removed = await admin.auth.admin.deleteUser(data.user.id)
    if (removed.error) throw removed.error
  }
})
