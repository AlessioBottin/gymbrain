import type { Ref } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhoopRecord, WhoopLink } from '../../shared/whoop';
import { db } from '../lib/store';
export function useWhoop(
  client: Ref<SupabaseClient | null>,
  owner: Ref<string | undefined>,
  local: Ref<boolean>,
  online: Ref<boolean>,
) {
  const info = ref<{
    configured: boolean;
    connected: boolean;
    lastSync?: string;
    pending?: boolean;
    error?: string;
  }>({ configured: false, connected: false });
  const records = ref<WhoopRecord[]>([]),
    links = ref<WhoopLink[]>([]),
    loading = ref(false),
    message = ref(''),
    disconnectOpen = ref(false);
  let timer: ReturnType<typeof setInterval> | undefined;
  async function request(path: string, body?: object) {
    const id = owner.value;
    if (!online.value) throw new Error('Collegati a Internet per aggiornare WHOOP.');
    const session = (await client.value?.auth.getSession())?.data.session;
    if (!session || session.user.id !== id) throw new Error('Accedi per collegare WHOOP.');
    const response = await fetch('/api/whoop/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: 'Bearer ' + session.access_token,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(90000),
    });
    const result = await response.json();
    if (owner.value !== id) throw new Error('Account cambiato');
    if (!response.ok) throw new Error(result.error || 'WHOOP non disponibile');
    return result;
  }
  async function load(id: string) {
    const all: WhoopRecord[] = [];
    let next = 0,
      more = true,
      newLinks: WhoopLink[] = [];
    while (more) {
      const page = await request('data?after=' + next);
      all.push(...page.records);
      if (!next) newLinks = page.links;
      if (page.more && page.next <= next) throw new Error('Risposta WHOOP non valida');
      next = page.next;
      more = page.more;
    }
    if (owner.value !== id) return;
    records.value = all;
    links.value = newLinks;
    await db.meta.put({ key: id + ':whoop', value: { records: all, links: newLinks, info: info.value } });
  }
  async function run(action: (id: string) => Promise<void>) {
    if (loading.value || local.value || !owner.value) return;
    const id = owner.value;
    loading.value = true;
    message.value = '';
    try {
      await action(id);
    } catch (error) {
      if (owner.value === id)
        message.value = error instanceof Error ? error.message : 'WHOOP non disponibile';
    } finally {
      loading.value = false;
      if (owner.value !== id && owner.value && online.value && !local.value) void sync(true);
    }
  }
  async function sync(automatic = false) {
    await run(async (id) => {
      info.value = await request('status');
      if (!info.value.configured) return;
      if (info.value.connected) {
        let result = await request('sync', { automatic });
        for (let i = 0; i < 11 && result.more; i++) result = await request('sync', { automatic: false });
        message.value = result.more
          ? 'Storico in importazione: proseguir? al prossimo aggiornamento.'
          : 'Dati WHOOP aggiornati.';
        info.value = await request('status');
      }
      await load(id);
    });
  }
  async function connect() {
    await run(async () => {
      const result = await request('connect', {});
      const url = new URL(result.url);
      if (url.origin !== 'https://api.prod.whoop.com') throw new Error('Indirizzo non valido');
      location.assign(url.href);
    });
  }
  async function disconnect() {
    await run(async () => {
      await request('disconnect', {});
      info.value.connected = false;
      disconnectOpen.value = false;
      message.value = 'WHOOP scollegato. Lo storico importato rimane disponibile.';
    });
  }
  async function link(session: string, workout: string | null) {
    await run(async (id) => {
      await request('link', { session, workout });
      await load(id);
    });
  }
  watch(
    [owner, online, local],
    async () => {
      const id = owner.value;
      records.value = [];
      links.value = [];
      info.value = { configured: false, connected: false };
      message.value = '';
      if (!id || local.value) return;
      const cached = (await db.meta.get(id + ':whoop'))?.value;
      if (owner.value !== id) return;
      if (cached) {
        records.value = cached.records;
        links.value = cached.links;
        info.value = cached.info;
      }
      if (online.value) void sync(true);
    },
    { immediate: true },
  );
  onMounted(() => {
    const url = new URL(location.href),
      result = url.searchParams.get('whoop');
    if (result) {
      message.value =
        result === 'connected'
          ? 'WHOOP collegato. Importazione in corso.'
          : 'Collegamento WHOOP non completato.';
      url.searchParams.delete('whoop');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    timer = setInterval(() => {
      if (online.value && !document.hidden) void sync(true);
    }, 300000);
  });
  onUnmounted(() => clearInterval(timer));
  return { info, records, links, loading, message, disconnectOpen, sync, connect, disconnect, link };
}
