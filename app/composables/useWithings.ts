import type { SupabaseClient } from '@supabase/supabase-js'
import type { Ref } from 'vue'

export function useWithings(
  client: Ref<SupabaseClient | null>,
  owner: Ref<string | undefined>,
  local: Ref<boolean>,
  online: Ref<boolean>,
  reload: () => Promise<void>,
) {
  const info = ref<{
    configured: boolean
    connected: boolean
    lastSync?: string
    notifications?: boolean
    pending?: boolean
    error?: string
  }>({ configured: false, connected: false })
  const loading = ref(false),
    message = ref(''),
    checked = ref(false),
    disconnectOpen = ref(false)
  let timer: ReturnType<typeof setInterval> | undefined
  async function request(path: string, body?: object) {
    if (!online.value) throw new Error('Collegati a Internet per usare Withings.')
    const id = owner.value
    const session = await client.value?.auth.getSession()
    if (!session?.data.session || session.data.session.user.id !== id)
      throw new Error('Accedi di nuovo per collegare Withings.')
    const response = await fetch('/api/withings/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: 'Bearer ' + session.data.session.access_token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(90000),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Withings non disponibile. Riprova.')
    if (id !== owner.value) throw new Error('Account cambiato')
    return result
  }
  async function refresh() {
    info.value = await request('status')
    checked.value = true
  }
  async function run(action: () => Promise<void>) {
    if (loading.value || local.value || !owner.value) return
    const id = owner.value
    loading.value = true
    message.value = ''
    try {
      await action()
    } catch (error) {
      if (id === owner.value)
        message.value = error instanceof Error ? error.message : 'Collegamento non disponibile'
    } finally {
      loading.value = false
      if (id !== owner.value && owner.value && online.value && !local.value) void syncWeights(true)
    }
  }
  async function syncWeights(automatic = false) {
    await run(async () => {
      await refresh()
      if (!info.value.connected) return
      let result = await request('sync', { automatic }),
        imported = result.imported || 0
      // Bounded batches keep long histories resumable across requests and restarts.
      for (let i = 0; i < 9 && result.more && !result.busy; i++) {
        result = await request('sync', { automatic: false })
        imported += result.imported || 0
      }
      await reload()
      await refresh()
      message.value = result.busy
        ? 'Sincronizzazione già in corso.'
        : result.more
          ? 'Importazione in corso: proseguirà al prossimo aggiornamento.'
          : `${imported} pesate aggiornate. Il diario è sincronizzato.`
    })
  }
  async function connect() {
    await run(async () => {
      const result = await request('connect', {})
      const url = new URL(result.url)
      if (url.origin !== 'https://account.withings.com')
        throw new Error('Indirizzo Withings non valido')
      location.assign(url.href)
    })
  }
  async function disconnect() {
    await run(async () => {
      await request('disconnect', {})
      disconnectOpen.value = false
      await refresh()
      message.value = 'Withings scollegato. Le pesate già importate restano nel diario.'
    })
  }
  watch(
    [owner, online, local],
    () => {
      info.value = { configured: false, connected: false }
      checked.value = false
      message.value = ''
      if (owner.value && online.value && !local.value) void syncWeights(true)
    },
    { immediate: true },
  )
  onMounted(() => {
    const url = new URL(location.href),
      result = url.searchParams.get('withings')
    if (result) {
      message.value =
        result === 'connected'
          ? 'Withings collegato. Importazione delle pesate in corso.'
          : 'Collegamento non completato. Riprova da questo browser.'
      url.searchParams.delete('withings')
      history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    timer = setInterval(() => {
      if (online.value && !document.hidden) void syncWeights(true)
    }, 300000)
  })
  onUnmounted(() => clearInterval(timer))
  return { info, loading, message, checked, disconnectOpen, connect, disconnect, syncWeights }
}
