import type { Ref } from 'vue'

// Each tab controls its own reload, even when another tab activates the worker.
// IndexedDB (including unsent mutations) is never cleared by an application update.
export function useAppUpdates(blocked: Ref<boolean>) {
  const available = ref(false)
  let registration: ServiceWorkerRegistration | undefined
  let controller: ServiceWorker | null = null
  let changed = false
  let activating = false
  let checking = false
  let idleSince = 0
  let stopped = false
  let poll: ReturnType<typeof setInterval> | undefined
  let idle: ReturnType<typeof setInterval> | undefined

  function applyWhenSafe() {
    if (registration?.waiting) available.value = true
    const editing =
      document.querySelector('dialog[open]') ||
      document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')
    if (blocked.value || editing || document.visibilityState !== 'visible' || !navigator.onLine) {
      idleSince = 0
      return
    }
    if (!idleSince) idleSince = Date.now()
    if (Date.now() - idleSince < 2000) return
    if (changed) {
      window.location.reload()
      return
    }
    if (registration?.waiting && !activating) {
      activating = true
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
  }
  function controlled() {
    const next = navigator.serviceWorker.controller
    if (controller && next !== controller) {
      changed = true
      available.value = true
    }
    controller = next
    applyWhenSafe()
  }
  async function check() {
    if (!registration || checking || !navigator.onLine || document.visibilityState !== 'visible')
      return
    checking = true
    try {
      await registration.update()
    } catch {
      /* Offline, suspended or server waking up: retry later. */
    } finally {
      checking = false
    }
    if (!stopped) applyWhenSafe()
  }
  onMounted(async () => {
    if (import.meta.dev || !('serviceWorker' in navigator)) return
    controller = navigator.serviceWorker.controller
    navigator.serviceWorker.addEventListener('controllerchange', controlled)
    window.addEventListener('online', check)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    // Poll waiting as well as updatefound: this also covers a worker left by a previous visit.
    idle = setInterval(applyWhenSafe, 1000)
    poll = setInterval(check, 60000)
    try {
      registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      if (!stopped) await check()
    } catch {
      /* Registration can be unavailable on the first offline visit. */
    }
  })
  onUnmounted(() => {
    stopped = true
    clearInterval(poll)
    clearInterval(idle)
    navigator.serviceWorker?.removeEventListener('controllerchange', controlled)
    window.removeEventListener('online', check)
    window.removeEventListener('focus', check)
    document.removeEventListener('visibilitychange', check)
  })
  return { available }
}
