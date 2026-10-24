<script setup lang="ts">
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { liveQuery } from 'dexie';
import { useImmersiveMotion } from './composables/useImmersiveMotion';
import { db, saveRecord, synchronize, removeAccountCache, resolveConflict } from './lib/store';
import { activeCycle, activePlan, comparePlanDates } from '../shared/cycles';
import { freezeTargets } from '../shared/volume';
import { createStarter } from './lib/sample';
import {
  snapshotSession,
  type LocalRecord,
  type Kind,
  type Exercise,
  type Workout,
  type TrainingSession,
  type Payload,
} from '../shared/domain';
const cfg = useRuntimeConfig(),
  auth = shallowRef<SupabaseClient | null>(null),
  authSession = ref<Session | null>(null),
  recovery = ref(false),
  ready = ref(false),
  local = ref(false);
const cachedIdentity = ref<{ id: string; name: string; email: string } | null>(null),
  reauth = ref(false);
const owner = computed(
    () =>
      authSession.value?.user.id ||
      (!local.value ? cachedIdentity.value?.id : '') ||
      (local.value ? 'local-device' : ''),
  ),
  displayName = computed(
    () =>
      authSession.value?.user.user_metadata?.display_name ||
      (!local.value ? cachedIdentity.value?.name : '') ||
      'Atleta',
  );
const rows = ref<LocalRecord[]>([]),
  pending = ref(0),
  view = ref('oggi'),
  search = ref(''),
  status = ref('Connessione al tuo account...'),
  online = ref(true),
  busy = ref(false),
  savingRecord = ref(false),
  toast = ref(''),
  cycleId = ref(''),
  previousCycleId = ref(''),
  planId = ref(''),
  previousPlanId = ref(''),
  workoutId = ref(''),
  sessionRecord = ref<LocalRecord | null>(null),
  focusMode = ref(false),
  builderOpen = ref(false),
  builderPlan = ref<LocalRecord | null>(null);
function openBuilder() {
  if (!plan.value) return;
  builderPlan.value = plan.value;
  builderOpen.value = true;
}
const builderWorkouts = computed(() =>
  rows.value
    .filter((r) => r.kind === 'workout' && r.parent_id === builderPlan.value?.id && !r.deleted)
    .sort((a, b) => (a.payload as Workout).order - (b.payload as Workout).order),
);
const withings = useWithings(auth, owner, local, online, sync);
const whoop = useWhoop(auth, owner, local, online);
useImmersiveMotion();
const catalogSearch = ref<HTMLInputElement>();
watch(catalogSearch, (input) => input?.focus({ preventScroll: true }), { flush: 'post' });
watch(view, async () => {
  await nextTick();
  window.scrollTo({ top: 0, behavior: 'instant' });
});
const updates = useAppUpdates(
  computed(
    () =>
      !ready.value ||
      !owner.value ||
      focusMode.value ||
      builderOpen.value ||
      busy.value ||
      withings.loading.value ||
      whoop.loading.value ||
      reauth.value ||
      recovery.value,
  ),
);
const editor = reactive<{ open: boolean; kind: Kind; record?: LocalRecord; parentId?: string }>({
    open: false,
    kind: 'exercise',
  }),
  deleteRecord = ref<LocalRecord | null>(null),
  logoutOpen = ref(false),
  historyRecord = ref<LocalRecord | null>(null),
  videoUrl = ref(''),
  conflictRecord = ref<LocalRecord | null>(null);
function localToday() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}
const catalog = computed(() => rows.value.filter((r) => r.kind === 'exercise' && !r.deleted)),
  cycles = computed(() => rows.value.filter((r) => r.kind === 'cycle' && !r.deleted)),
  cycle = computed(() => {
    return (
      cycles.value.find((r) => r.id === cycleId.value) ||
      activeCycle(cycles.value, localToday()) ||
      cycles.value.find((r) => r.id === previousCycleId.value) ||
      cycles.value[0]
    );
  }),
  plans = computed(() =>
    rows.value
      .filter((r) => r.kind === 'plan' && r.parent_id === cycle.value?.id && !r.deleted)
      .sort(comparePlanDates),
  ),
  plan = computed(
    () =>
      plans.value.find((r) => r.id === planId.value) ||
      activePlan(plans.value, localToday()) ||
      plans.value.find((r) => r.id === previousPlanId.value) ||
      plans.value[0],
  ),
  workouts = computed(() =>
    rows.value
      .filter((r) => r.kind === 'workout' && r.parent_id === plan.value?.id && !r.deleted)
      .sort((a, b) => (a.payload as Workout).order - (b.payload as Workout).order),
  ),
  workout = computed(() => workouts.value.find((r) => r.id === workoutId.value) || workouts.value[0]),
  workoutData = computed(() => workout.value?.payload as Workout | undefined);
const sessions = computed(() =>
    rows.value
      .filter((r) => r.kind === 'session' && !r.deleted)
      .sort((a, b) =>
        (b.payload as TrainingSession).startedAt.localeCompare((a.payload as TrainingSession).startedAt),
      ),
  ),
  completed = computed(() => sessions.value.filter((r) => (r.payload as TrainingSession).completedAt)),
  ongoing = computed(() =>
    sessions.value.find(
      (r) =>
        !(r.payload as TrainingSession).completedAt &&
        (r.payload as TrainingSession).workoutId === workout.value?.id,
    ),
  ),
  weights = computed(() =>
    rows.value
      .filter((r) => r.kind === 'weight' && !r.deleted)
      .sort((a, b) => (a.payload as any).measuredAt.localeCompare((b.payload as any).measuredAt)),
  ),
  latestWeight = computed(
    () =>
      weights.value.at(-1)?.payload as
        | { kg: number; measuredAt: string; source: 'manual' | 'withings' }
        | undefined,
  ),
  conflicts = computed(() => rows.value.filter((r) => r.conflict)),
  filteredCatalog = computed(() =>
    catalog.value.filter((r) =>
      (r.payload as Exercise).name.toLowerCase().includes(search.value.toLowerCase()),
    ),
  );
const modeNames: Record<string, string> = {
  bodyweight: 'Corpo libero',
  weighted: 'Zavorra',
  external: 'Carico esterno',
  band: 'Banda elastica',
};
const week = computed(() =>
  cycle.value
    ? Math.max(
        1,
        Math.min(
          (cycle.value.payload as any).weeks,
          Math.floor((Date.now() - new Date((cycle.value.payload as any).start).getTime()) / 604800000) + 1,
        ),
      )
    : 1,
);
const monday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};
const weekly = computed(() =>
  completed.value.filter((r) => new Date((r.payload as TrainingSession).completedAt!) >= monday()),
);
const activity = computed(() =>
  Array.from({ length: 7 }, (_, i) =>
    weekly.value.some((r) => (new Date((r.payload as TrainingSession).completedAt!).getDay() + 6) % 7 === i),
  ),
);
const graph = computed(() => {
  const values = weights.value.slice(-14).map((r) => (r.payload as any).kg as number);
  if (values.length < 2) return '';
  const min = Math.min(...values) - 0.2,
    range = Math.max(...values) - min + 0.2;
  return values
    .map((n, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1)) * 280},${68 - ((n - min) / range) * 60}`)
    .join(' ');
});
let unsubscribe: (() => void) | undefined,
  authSubscription: { unsubscribe: () => void } | undefined,
  interval: ReturnType<typeof setInterval> | undefined,
  toastTimer: ReturnType<typeof setTimeout>,
  syncing = false;
let syncTask: Promise<void> | undefined;
function notify(message: string) {
  toast.value = message;
  void nextTick(() => {
    const node = document.getElementById('toast') as HTMLElement | null;
    if (node?.showPopover && !node.matches(':popover-open')) node.showPopover();
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ''), 5000);
}
async function sync() {
  if (syncTask) return syncTask;
  if (!owner.value) return;
  if (local.value) {
    status.value = 'Solo dispositivo';
    return;
  }
  const id = owner.value;
  syncing = true;
  syncTask = (async () => {
    try {
      await synchronize(
        id,
        async () => {
          const { data } = await auth.value!.auth.getSession();
          return data.session?.user.id === id ? data.session.access_token : null;
        },
        (s) => {
          if (owner.value === id) status.value = s;
        },
      );
    } finally {
      syncing = false;
      syncTask = undefined;
    }
  })();
  return syncTask;
}
async function observeOwner() {
  editor.open = false;
  builderOpen.value = false;
  builderPlan.value = null;
  unsubscribe?.();
  rows.value = [];
  pending.value = 0;
  sessionRecord.value = null;
  focusMode.value = false;
  cycleId.value = '';
  previousCycleId.value = '';
  planId.value = '';
  previousPlanId.value = '';
  workoutId.value = '';
  const id = owner.value;
  if (!id) return;
  const saved = (await db.meta.get(id + ':selection'))?.value;
  if (owner.value !== id) return;
  if (saved) {
    previousCycleId.value = saved.cycle || '';
    previousPlanId.value = saved.plan || '';
    workoutId.value = saved.workout || '';
  }
  const sub = liveQuery(async () => ({
    records: await db.records.where('user_id').equals(id).toArray(),
    pending: await db.queue.where('owner').equals(id).count(),
  })).subscribe({
    next: (value) => {
      if (owner.value === id) {
        rows.value = value.records;
        pending.value = value.pending;
      }
    },
    error: () => notify('Impossibile aprire l’archivio del dispositivo.'),
  });
  unsubscribe = () => sub.unsubscribe();
  void sync();
}
watch(owner, observeOwner);
watch([cycleId, planId, workoutId], () => {
  if (owner.value)
    void db.meta.put({
      key: owner.value + ':selection',
      value: { cycle: cycleId.value, plan: planId.value, workout: workoutId.value },
    });
});
function connectivity() {
  online.value = navigator.onLine;
  if (online.value) void sync();
  else status.value = 'Offline · salvato sul dispositivo';
}
onMounted(async () => {
  try {
    cachedIdentity.value = JSON.parse(localStorage.getItem('gymbrain-last-account') || 'null');
  } catch {}
  online.value = navigator.onLine;
  window.addEventListener('online', connectivity);
  window.addEventListener('offline', connectivity);
  if (cfg.public.supabaseUrl && cfg.public.supabaseKey) {
    auth.value = createClient(String(cfg.public.supabaseUrl), String(cfg.public.supabaseKey));
    const { data } = auth.value.auth.onAuthStateChange((event, session) => {
      authSession.value = session;
      if (session) {
        local.value = false;
        localStorage.removeItem('gymbrain-local');
        reauth.value = false;
        cachedIdentity.value = {
          id: session.user.id,
          name: session.user.user_metadata?.display_name || 'Atleta',
          email: session.user.email || '',
        };
        localStorage.setItem('gymbrain-last-account', JSON.stringify(cachedIdentity.value));
      }
      if (event === 'PASSWORD_RECOVERY') recovery.value = true;
    });
    authSubscription = data.subscription;
    if (navigator.onLine) {
      const session = await auth.value.auth.getSession();
      authSession.value = session.data.session;
    }
  }
  local.value =
    Boolean(cfg.public.allowLocalDemo) &&
    !authSession.value &&
    localStorage.getItem('gymbrain-local') === 'yes';
  ready.value = true;
  interval = setInterval(() => void sync(), 30000);
});
onUnmounted(() => {
  unsubscribe?.();
  authSubscription?.unsubscribe();
  clearInterval(interval);
  clearTimeout(toastTimer);
  window.removeEventListener('online', connectivity);
  window.removeEventListener('offline', connectivity);
});
function enterLocal() {
  if (!cfg.public.allowLocalDemo) return;
  localStorage.setItem('gymbrain-local', 'yes');
  local.value = true;
}
function openEditor(kind: Kind, record?: LocalRecord, parentId?: string) {
  if (!record && kind !== 'weight' && !local.value && !online.value) {
    notify('Torna online per creare esercizi, mesocicli e schede. L’allenamento resta disponibile offline.');
    return;
  }
  Object.assign(editor, { open: true, kind, record, parentId });
}
async function save(
  kind: Kind,
  payload: Payload,
  id?: string,
  parentId?: string | null,
  expectedRevision?: number,
) {
  if (savingRecord.value) return;
  savingRecord.value = true;
  const account = owner.value;
  try {
    const saved = await saveRecord(account, kind, payload, { id, parentId, expectedRevision });
    if (!local.value) {
      try {
        await sync();
        if (owner.value === account && (await db.records.get([account, saved.id]))?.dirty && online.value)
          await sync();
      } catch {
        status.value = 'Sincronizzazione in attesa';
      }
    }
    const pending = (await db.records.get([account, saved.id]))?.dirty;
    if (owner.value !== account) return;
    editor.open = false;
    localStorage.removeItem(`gymbrain-draft:${owner.value}:${kind}:${id || parentId || 'new'}`);
    notify(
      local.value
        ? 'Salvato nella demo'
        : pending
          ? 'Modifiche protette: sincronizzazione in attesa. Verranno inviate appena la connessione torna disponibile.'
          : 'Salvato online',
    );
  } catch (e) {
    notify(e instanceof Error ? e.message : 'Salvataggio non riuscito');
  } finally {
    savingRecord.value = false;
  }
}
async function seed() {
  busy.value = true;
  try {
    const result = await createStarter(owner.value);
    cycleId.value = result.cycle;
    planId.value = result.plan;
    notify('Percorso iniziale creato: puoi personalizzarlo.');
    void sync();
  } catch (e) {
    notify(String(e));
  } finally {
    busy.value = false;
  }
}
function sessionSnapshot(row: LocalRecord) {
  const snapshot = snapshotSession(row, latestWeight.value?.kg ?? null);
  snapshot.exercises = snapshot.exercises.map((e) => ({ ...e, ...freezeTargets(e, catalog.value) }));
  return snapshot;
}
watch(
  () => plan.value?.id,
  () => {
    builderOpen.value = false;
  },
);
async function removeWorkoutExercise(exerciseId: string) {
  if (!workout.value || busy.value) return;
  const row = workout.value;
  const payload = JSON.parse(JSON.stringify(row.payload)) as Workout;
  payload.exercises = payload.exercises.filter((e) => e.id !== exerciseId);
  for (const exercise of payload.exercises)
    if (exercise.group && payload.exercises.filter((e) => e.group?.id === exercise.group?.id).length < 2)
      exercise.group = undefined;
  busy.value = true;
  try {
    await saveRecord(owner.value, 'workout', payload, {
      id: row.id,
      parentId: row.parent_id,
      expectedRevision: row.localRevision,
    });
    void sync();
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}
async function start() {
  try {
    if (ongoing.value) {
      sessionRecord.value = ongoing.value;
      focusMode.value = true;
      return;
    }
    if (!workout.value || !workoutData.value?.exercises.length) {
      notify('Aggiungi almeno un esercizio alla giornata.');
      return;
    }
    sessionRecord.value = await saveRecord(owner.value, 'session', sessionSnapshot(workout.value));
    focusMode.value = true;
  } catch (e) {
    notify(String(e));
  }
}
async function sessionComplete() {
  focusMode.value = false;
  const i = workouts.value.findIndex(
    (w) => w.id === (sessionRecord.value!.payload as TrainingSession).workoutId,
  );
  workoutId.value = workouts.value[(i + 1) % workouts.value.length]?.id || '';
  view.value = 'progressi';
  notify('Allenamento salvato. Un passo in più.');
  void sync();
}
async function destroy() {
  const r = deleteRecord.value;
  if (!r) return;
  try {
    if (rows.value.some((x) => x.parent_id === r.id && !x.deleted))
      throw new Error('Elimina prima gli elementi contenuti.');
    await saveRecord(owner.value, r.kind, r.payload, {
      id: r.id,
      deleted: true,
      expectedRevision: r.localRevision,
    });
    deleteRecord.value = null;
    notify('Elemento eliminato. Lo storico delle sessioni resta intatto.');
    void sync();
  } catch (e) {
    notify(String(e));
  }
}
async function logout() {
  if (!local.value && pending.value) {
    notify('Sincronizza o risolvi i conflitti prima di uscire. Puoi esportare i dati.');
    return;
  }
  if (syncing) {
    notify('Attendi il termine della sincronizzazione.');
    return;
  }
  const id = owner.value;
  if (auth.value && !local.value) {
    const { error } = await auth.value.auth.signOut({ scope: 'local' });
    if (error) {
      notify(error.message);
      return;
    }
    await removeAccountCache(id);
  } else if (!local.value) {
    await removeAccountCache(id);
  }
  cachedIdentity.value = null;
  localStorage.removeItem('gymbrain-last-account');
  reauth.value = false;
  local.value = false;
  localStorage.removeItem('gymbrain-local');
  logoutOpen.value = false;
  view.value = 'oggi';
}
function exportData() {
  const blob = new Blob(
    [
      JSON.stringify(
        { format: 'gymbrain-export-v1', exportedAt: new Date().toISOString(), records: rows.value },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = 'gymbrain-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function mediaRequest(endpoint: string, body: unknown) {
  const { data } = await auth.value!.auth.getSession();
  if (!data.session) throw new Error('Accedi di nuovo');
  const response = await fetch('/api/media/' + endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + data.session.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(75000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Operazione non disponibile');
  return result;
}
async function uploadVideo(row: LocalRecord, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!auth.value || local.value || !online.value) {
    notify('Collega un account e torna online per caricare video.');
    return;
  }
  if (file.size > 25 * 1024 * 1024 || !['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) {
    notify('Scegli un video MP4, WebM o MOV fino a 25 MB.');
    return;
  }
  busy.value = true;
  try {
    const id = owner.value,
      upload = await mediaRequest('upload-url', { type: file.type, size: file.size }),
      path = upload.path;
    const { error } = await auth.value.storage
      .from('exercise-videos')
      .uploadToSignedUrl(path, upload.token, file, { contentType: file.type });
    if (error) throw error;
    await saveRecord(
      id,
      'exercise',
      { ...(row.payload as Exercise), videoPath: path },
      { id: row.id, expectedRevision: row.localRevision },
    );
    notify('Video allegato.');
    void sync();
  } catch (e) {
    notify(String(e));
  } finally {
    busy.value = false;
    (event.target as HTMLInputElement).value = '';
  }
}
async function playVideo(row: LocalRecord) {
  const e = row.payload as Exercise;
  if (e.videoPath) {
    if (!auth.value || !online.value) {
      notify('Questo allegato richiede una connessione.');
      return;
    }
    try {
      videoUrl.value = (await mediaRequest('download-url', { path: e.videoPath })).url;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Video non disponibile');
    }
  } else if (e.videoUrl) {
    window.open(e.videoUrl, '_blank', 'noopener,noreferrer');
  }
}
async function resolve(keep: boolean) {
  if (!conflictRecord.value) return;
  await resolveConflict(owner.value, conflictRecord.value.id, keep);
  conflictRecord.value = null;
  void sync();
}
const date = (value: string) =>
  new Date(value).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
</script>
<template>
  <NuxtPwaManifest />
  <div class="ambient" aria-hidden="true" />
  <div class="marble-sculpture" aria-hidden="true" />
  <div v-if="!ready" class="loading-screen">
    <img src="/favicon.svg" alt="Gymbrain" />
    <p>Prepariamo il tuo spazio…</p>
  </div>
  <AuthPanel
    v-else-if="!owner || recovery || reauth"
    :client="auth"
    :allow-local="Boolean(cfg.public.allowLocalDemo)"
    :recovery="recovery"
    @local="enterLocal"
    @recovered="recovery = false"
  /><template v-else
    ><aside class="sidebar">
      <a class="brand" href="#" @click.prevent="view = 'oggi'"
        ><img src="/favicon.svg" alt="" />gymbrain<span>®</span></a
      >
      <div class="side-label">IL TUO SPAZIO</div>
      <nav aria-label="Navigazione principale">
        <button
          v-for="n in [
            ['oggi', 'Oggi', 'grid'],
            ['percorso', 'Percorso', 'layers'],
            ['esercizi', 'Esercizi', 'barbell'],
            ['progressi', 'Progressi', 'chart'],
            ['account', 'Account', 'info'],
          ]"
          :key="n[0]"
          :class="{ active: view === n[0] }"
          :aria-current="view === n[0] ? 'page' : undefined"
          @click="view = n[0]!"
        >
          <span><GIcon :name="n[2]!" /></span>{{ n[1] }}
        </button>
      </nav>
      <div class="side-bottom">
        <span class="demo-dot" />{{
          local ? 'Solo dispositivo' : online ? 'Il tuo spazio personale' : 'Sei offline'
        }}
        <p>
          {{ local ? 'Dati locali, senza sincronizzazione' : pending + ' modifiche in attesa' }}
        </p>
        <button class="profile profile-button" @click="view = 'account'">
          <span class="avatar">{{ displayName[0] }}</span
          ><span>{{ displayName }}<small>Il tuo ritmo. Il tuo percorso.</small></span>
        </button>
      </div>
    </aside>
    <main>
      <header>
        <span
          >Il tuo spazio <i>/</i>
          {{
            {
              oggi: 'Oggi',
              percorso: 'Percorso',
              esercizi: 'Esercizi',
              progressi: 'Progressi',
              account: 'Account',
            }[view as 'oggi']
          }}</span
        ><button class="sync-chip" :class="{ offline: !online }" @click="view = 'account'">
          {{
            local
              ? 'Solo dispositivo'
              : !online
                ? 'Offline'
                : pending
                  ? pending + ' da sincronizzare'
                  : 'Il tuo spazio'
          }}<span class="avatar small">{{ displayName[0] }}</span>
        </button>
      </header>
      <div v-if="conflicts.length" class="conflict-banner">
        <span>{{ conflicts.length }} modifiche richiedono la tua scelta.</span
        ><button class="text-btn" @click="conflictRecord = conflicts[0]!">Risolvi →</button>
      </div>
      <div id="content">
        <Transition name="view" mode="out-in"
          ><div :key="view">
            <template v-if="view === 'oggi' || view === 'percorso'"
              ><div class="intro">
                <div>
                  <span class="eyebrow">MENS SANA IN CORPORE SANO.</span>
                  <h1 v-if="view === 'oggi'">Ogni serie <em>conta.</em></h1>
                  <h1 v-else>Una direzione. <em>La tua.</em></h1>
                  <p>
                    {{
                      view === 'oggi'
                        ? `Bentornato, ${displayName}. Costruiamo il tuo prossimo livello.`
                        : 'Mesocicli, schede e giornate. Al tuo ritmo.'
                    }}
                  </p>
                </div>
                <div class="date">
                  {{
                    new Date().toLocaleDateString('it-IT', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })
                  }}<br />Il momento giusto è adesso.
                </div>
              </div>
              <div v-if="view === 'percorso'" class="guided-path" aria-label="Passi della programmazione">
                <button @click="view = 'esercizi'">
                  <b>01</b><span>Movimenti<small>Il tuo catalogo</small></span>
                </button>
                <button @click="openEditor('cycle', cycle)">
                  <b>02</b
                  ><span
                    >Ciclo<small>{{ cycle ? 'Personalizza' : 'Crea la direzione' }}</small></span
                  >
                </button>
                <button :disabled="!cycle" @click="openEditor('plan', plan, cycle?.id)">
                  <b>03</b
                  ><span
                    >Scheda<small>{{ plan ? 'Personalizza' : 'Organizza' }}</small></span
                  >
                </button>
                <button :disabled="!plan" @click="openEditor('workout', workout, plan?.id)">
                  <b>04</b><span>Giornata<small>Serie e obiettivi</small></span>
                </button>
              </div>
              <section v-if="!cycles.length" class="hero empty-hero">
                <span class="eyebrow">IL TUO PRIMO PASSO</span>
                <h2>Fai spazio<br />alla tua forza.</h2>
                <p>Crea il tuo mesociclo o parti da una scheda modificabile.</p>
                <div class="button-group">
                  <button class="primary" :disabled="busy" @click="seed">
                    {{ busy ? 'Creazione…' : 'Usa percorso iniziale' }}
                    <GIcon name="arrow" /></button
                  ><button class="secondary" @click="openEditor('cycle')">Crea da zero +</button>
                </div>
                <div class="orb" aria-hidden="true"><i v-for="i in 6" :key="i" /></div>
              </section>
              <template v-else
                ><div v-if="view === 'percorso'" class="selection-bar">
                  <label
                    >Mesociclo<select
                      :value="cycle?.id"
                      @change="
                        cycleId = ($event.target as HTMLSelectElement).value;
                        planId = '';
                        workoutId = '';
                      "
                    >
                      <option v-for="c in cycles" :key="c.id" :value="c.id">
                        {{ (c.payload as any).name }}
                      </option>
                    </select></label
                  ><button class="secondary" @click="openEditor('cycle')">Nuovo mesociclo +</button
                  ><button class="text-btn" @click="openEditor('cycle', cycle)">Modifica</button
                  ><button
                    class="icon-btn danger"
                    @click="deleteRecord = cycle!"
                    aria-label="Elimina"
                    title="Elimina"
                  >
                    <GIcon name="trash" :size="18" />
                  </button>
                </div>
                <section v-if="view === 'percorso'" class="plan-catalog" aria-label="Schede del mesociclo">
                  <div class="panel-title">
                    <h2>Le tue schede</h2>
                    <button class="primary" @click="openEditor('plan', undefined, cycle!.id)">
                      Nuova scheda <GIcon name="plus" />
                    </button>
                  </div>
                  <div class="plan-library">
                    <article
                      v-for="p in plans"
                      :key="p.id"
                      class="panel plan-card"
                      :class="{ selected: p.id === plan?.id }"
                    >
                      <div class="inline-top">
                        <GIcon name="layers" />
                        <div class="button-group">
                          <button
                            class="icon-btn"
                            :aria-label="'Modifica scheda ' + (p.payload as any).name"
                            title="Modifica scheda"
                            @click="openEditor('plan', p)"
                          >
                            <GIcon name="edit" :size="18" />
                          </button>
                          <button
                            class="icon-btn danger"
                            :aria-label="'Elimina scheda ' + (p.payload as any).name"
                            title="Elimina scheda"
                            @click="deleteRecord = p"
                          >
                            <GIcon name="trash" :size="18" />
                          </button>
                        </div>
                      </div>
                      <h3>{{ (p.payload as any).name }}</h3>
                      <dl class="plan-card-dates">
                        <div>
                          <dt>Inizio</dt>
                          <dd>
                            {{ (p.payload as any).start ? date((p.payload as any).start) : 'Da impostare' }}
                          </dd>
                        </div>
                        <div>
                          <dt>Fine</dt>
                          <dd>
                            {{ (p.payload as any).end ? date((p.payload as any).end) : 'Da impostare' }}
                          </dd>
                        </div>
                      </dl>
                      <p class="plan-card-notes">{{ (p.payload as any).notes }}</p>
                      <p class="subtle">
                        {{
                          rows.filter((r) => r.kind === 'workout' && r.parent_id === p.id && !r.deleted)
                            .length
                        }}
                        giornate
                      </p>
                      <button
                        class="secondary"
                        :aria-label="'Seleziona scheda ' + (p.payload as any).name"
                        :aria-pressed="p.id === plan?.id"
                        @click="
                          planId = p.id;
                          workoutId = '';
                        "
                      >
                        {{ p.id === plan?.id ? 'Scheda selezionata' : 'Mostra giornate' }}
                        <GIcon name="arrow" :size="18" />
                      </button>
                    </article>
                  </div>
                  <p v-if="!plans.length" class="notice">Crea la prima scheda di questo mesociclo.</p>
                </section>
                <div class="dashboard" :class="{ 'path-dashboard': view === 'percorso' }">
                  <section v-if="view === 'oggi'" class="hero">
                    <span class="eyebrow">IL TUO MESOCICLO</span>
                    <h2>{{ (cycle!.payload as any).name }}</h2>
                    <p>{{ (cycle!.payload as any).notes || 'Un allenamento alla volta.' }}</p>
                    <div class="orb" aria-hidden="true">
                      <i v-for="i in 6" :key="i" />
                      <div class="orb-center">
                        {{ String(week).padStart(2, '0') }}<small>SETTIMANA</small>
                      </div>
                    </div>
                    <div class="hero-bottom">
                      <div>
                        <span>SETTIMANA {{ week }} DI {{ (cycle!.payload as any).weeks }}</span>
                        <div class="week-track">
                          <b
                            v-for="i in Math.min((cycle!.payload as any).weeks, 12)"
                            :key="i"
                            :class="{ done: i <= week }"
                          />
                        </div>
                      </div>
                      <button v-if="view === 'oggi'" class="text-btn" @click="view = 'percorso'">
                        Esplora il percorso ↗</button
                      ><span v-else class="subtle">Dal {{ date((cycle!.payload as any).start) }}</span>
                    </div>
                  </section>
                  <section v-if="view === 'oggi'" class="panel weight-panel">
                    <div class="panel-title">
                      <h2>Il tuo peso</h2>
                      <button class="icon-btn" aria-label="Registra peso" @click="openEditor('weight')">
                        +
                      </button>
                    </div>
                    <div class="weight">
                      {{ latestWeight ? latestWeight.kg.toLocaleString('it-IT') : '—' }}<small>kg</small>
                    </div>
                    <div class="subtle">Un dato. Non il tuo valore.</div>
                    <svg
                      v-if="graph"
                      class="sparkline"
                      viewBox="0 0 280 75"
                      role="img"
                      aria-label="Andamento delle tue ultime pesate"
                    >
                      <path :d="graph" fill="none" stroke="#a9c8d4" stroke-width="2" />
                    </svg>
                    <div v-else class="graph-empty subtle">
                      {{
                        latestWeight
                          ? 'Registra un’altra pesata per vedere l’andamento.'
                          : 'La tua prima pesata ti aspetta.'
                      }}
                    </div>
                    <div class="weight-bottom">
                      <span>Registrazione manuale</span
                      ><span
                        >{{ latestWeight ? date(latestWeight.measuredAt) : 'Nessun dato'
                        }}{{ latestWeight?.source === 'withings' ? ' / Withings' : '' }}</span
                      >
                    </div>
                  </section>
                  <section class="panel workout" aria-label="Giornate della scheda selezionata">
                    <div class="workout-heading">
                      <div>
                        <span class="eyebrow">{{
                          ongoing ? 'IL TUO ALLENAMENTO TI ASPETTA' : 'IL TUO PROSSIMO PASSO'
                        }}</span>
                        <h2>{{ workoutData?.name || 'Crea la tua giornata' }}</h2>
                      </div>
                      <span class="round-arrow" aria-hidden="true">↗</span>
                    </div>
                    <div v-if="view === 'oggi'" class="plan-select">
                      <label
                        >Scheda<select
                          :value="plan?.id"
                          @change="
                            planId = ($event.target as HTMLSelectElement).value;
                            workoutId = '';
                          "
                        >
                          <option v-for="p in plans" :key="p.id" :value="p.id">
                            {{ (p.payload as any).name }}
                          </option>
                        </select></label
                      >
                    </div>
                    <p v-if="plan && (plan.payload as any).start" class="subtle">
                      Periodo: {{ date((plan.payload as any).start) }} – {{ date((plan.payload as any).end) }}
                    </p>
                    <button v-if="plan && view === 'percorso'" class="secondary" @click="openBuilder">
                      Apri builder scheda
                    </button>

                    <div
                      v-if="sessions.some((r) => !(r.payload as TrainingSession).completedAt)"
                      class="button-group"
                    >
                      <button
                        v-for="s in sessions.filter((r) => !(r.payload as TrainingSession).completedAt)"
                        :key="s.id"
                        class="text-btn"
                        @click="
                          sessionRecord = s;
                          focusMode = true;
                        "
                      >
                        Riprendi: {{ (s.payload as TrainingSession).name }}
                      </button>
                    </div>
                    <p v-if="plan" class="subtle">{{ (plan.payload as any).notes }}</p>
                    <div class="days">
                      <button
                        v-for="(w, i) in workouts"
                        :key="w.id"
                        class="day"
                        :class="{ selected: w.id === workout?.id }"
                        :aria-pressed="w.id === workout?.id"
                        @click="workoutId = w.id"
                      >
                        <strong>{{ String.fromCharCode(65 + i) }} · {{ (w.payload as Workout).name }}</strong
                        >{{ (w.payload as Workout).exercises.length }} esercizi
                      </button>
                    </div>
                    <div v-if="workoutData">
                      <div v-for="e in workoutData.exercises" :key="e.id" class="exercise-row">
                        <div class="exercise-symbol">
                          <GIcon :name="e.exerciseType === 'weights' ? 'barbell' : 'pullup'" />
                        </div>
                        <div class="exercise-info">
                          <strong>{{ e.name }}</strong
                          ><small
                            >{{ e.exerciseType === 'weights' ? 'Pesi' : 'Corpo libero'
                            }}{{ e.variant ? ' / ' + e.variant.name : ''
                            }}{{
                              e.assistance?.length ? ' / ' + e.assistance.map((b) => b.name).join(' + ') : ''
                            }}{{ e.band ? ' / ' + e.band : '' }}</small
                          ><small v-if="e.notes">{{ e.notes }}</small>
                        </div>
                        <span
                          >{{ e.sets.length }} ×
                          {{
                            e.sets
                              .map((s) => (e.measurement === 'duration' ? s.tut : s.reps) ?? '—')
                              .filter((v, i, a) => a.indexOf(v) === i)
                              .join('/')
                          }}
                          {{ e.measurement === 'duration' ? 's' : 'rep' }}</span
                        >
                        <button
                          v-if="view === 'percorso'"
                          type="button"
                          class="icon-btn danger"
                          :aria-label="`Rimuovi ${e.name} dalla giornata`"
                          title="Rimuovi dalla giornata"
                          :disabled="busy"
                          @click="removeWorkoutExercise(e.id)"
                        >
                          <GIcon name="trash" :size="18" />
                        </button>
                      </div>
                      <div class="workout-action">
                        <span class="subtle"
                          >{{ workoutData.exercises.length }} esercizi ·
                          {{ workoutData.exercises.reduce((n, e) => n + e.sets.length, 0) }}
                          serie</span
                        ><button class="primary" @click="start">
                          <span>{{ ongoing ? 'Riprendi sessione' : 'Avvia' }}</span>
                          <GIcon name="arrow" />
                        </button>
                      </div>
                    </div>
                    <p v-else class="notice">Aggiungi una scheda e le tue giornate per iniziare.</p>
                    <div v-if="view === 'percorso'" class="button-group editor-actions">
                      <button
                        v-if="plan"
                        class="text-btn"
                        @click="openEditor('workout', undefined, plan!.id)"
                      >
                        Nuova giornata +</button
                      ><button v-if="workout" class="text-btn" @click="openEditor('workout', workout)">
                        Modifica giornata</button
                      ><button
                        v-if="workout"
                        class="icon-btn danger"
                        @click="deleteRecord = workout!"
                        aria-label="Elimina giornata"
                        title="Elimina giornata"
                      >
                        <GIcon name="trash" :size="18" /></button
                      ><button
                        v-if="plan && !workouts.length"
                        class="icon-btn danger"
                        @click="deleteRecord = plan!"
                        aria-label="Elimina scheda"
                        title="Elimina scheda"
                      >
                        <GIcon name="trash" :size="18" />
                      </button>
                    </div>
                  </section>
                  <div v-if="view === 'oggi'" class="right-stack">
                    <section class="panel">
                      <div class="panel-title">
                        <h2>Ritmo settimanale</h2>
                        <span>QUESTA SETTIMANA</span>
                      </div>
                      <div class="activity-number">{{ weekly.length }}<small> sessioni</small></div>
                      <div class="week-bars">
                        <div v-for="(d, i) in ['L', 'M', 'M', 'G', 'V', 'S', 'D']" :key="i">
                          <b
                            :class="{
                              filled: activity[i],
                              today: (new Date().getDay() + 6) % 7 === i,
                            }"
                            :style="{ animationDelay: i * 60 + 'ms' }"
                          />{{ d }}
                        </div>
                      </div>
                      <span class="subtle">{{
                        weekly.length
                          ? 'La costanza sta prendendo forma.'
                          : 'Il primo passo fa la differenza.'
                      }}</span>
                    </section>
                    <div class="quote">
                      <p>“Non serve essere pronti.<br />Serve esserci.”</p>
                      <span>UN ALLENAMENTO ALLA VOLTA.</span>
                    </div>
                  </div>
                </div></template
              ></template
            >
            <template v-else-if="view === 'esercizi'"
              ><div class="intro">
                <div>
                  <span class="eyebrow">MOVIMENTI ESSENZIALI. POSSIBILITÀ INFINITE.</span>
                  <h1>Il tuo <em>repertorio.</em></h1>
                  <p>Le note generali restano qui. Quelle della scheda seguono il periodo.</p>
                </div>
                <button class="primary" @click="openEditor('exercise')">
                  Nuovo esercizio <GIcon name="plus" />
                </button>
              </div>
              <input
                ref="catalogSearch"
                v-model="search"
                class="search"
                type="search"
                aria-label="Cerca esercizi"
                placeholder="Cerca un movimento…"
              /><TransitionGroup name="list" tag="div" class="library"
                ><article v-for="e in filteredCatalog" :key="e.id" class="panel exercise-card">
                  <div class="inline-top">
                    <div class="exercise-symbol">
                      <GIcon
                        :name="(e.payload as Exercise).exerciseType === 'weights' ? 'barbell' : 'pullup'"
                      />
                    </div>
                    <button
                      class="icon-btn"
                      :aria-label="'Modifica ' + (e.payload as Exercise).name"
                      @click="openEditor('exercise', e)"
                    >
                      ✎
                    </button>
                  </div>
                  <span class="eyebrow">{{
                    (e.payload as Exercise).exerciseType === 'weights' ? 'Pesi' : 'Corpo libero'
                  }}</span>
                  <h2>{{ (e.payload as Exercise).name }}</h2>
                  <p v-if="(e.payload as Exercise).variants?.length" class="subtle">
                    {{ (e.payload as Exercise).variants.map((v) => v.name).join(' / ') }}
                  </p>
                  <p class="subtle">{{ (e.payload as Exercise).description }}</p>
                  <p class="subtle">{{ (e.payload as Exercise).notes }}</p>
                  <div class="card-tools">
                    <button
                      v-if="(e.payload as Exercise).videoPath || (e.payload as Exercise).videoUrl"
                      class="text-btn"
                      @click="playVideo(e)"
                    >
                      ▷ Video</button
                    ><label class="text-btn upload-label"
                      >Allega video<input
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime"
                        :disabled="busy"
                        @change="uploadVideo(e, $event)" /></label
                    ><button
                      class="icon-btn danger"
                      @click="deleteRecord = e"
                      aria-label="Elimina"
                      title="Elimina"
                    >
                      <GIcon name="trash" :size="18" />
                    </button>
                  </div></article
              ></TransitionGroup>
              <p v-if="!filteredCatalog.length" class="empty">
                {{
                  search
                    ? 'Nessun movimento corrisponde alla ricerca.'
                    : 'Crea il primo esercizio del tuo catalogo.'
                }}
              </p></template
            >
            <template v-else-if="view === 'progressi'"
              ><div class="intro">
                <div>
                  <span class="eyebrow">UN ALLENAMENTO ALLA VOLTA</span>
                  <h1>Il lavoro <em>si vede.</em></h1>
                  <p>{{ completed.length }} allenamenti completati. Ogni passo conta.</p>
                </div>
                <button class="secondary" @click="exportData">Esporta i tuoi dati ↗</button>
              </div>
              <WhoopPanel
                :info="whoop.info.value"
                :records="whoop.records.value"
                :links="whoop.links.value"
                :sessions="sessions"
                :loading="whoop.loading.value"
                :message="whoop.message.value"
                :online="online"
                :local="local"
                @connect="whoop.connect"
                @sync="whoop.sync(false)"
                @disconnect="whoop.disconnectOpen.value = true"
                @link="whoop.link"
              />
              <section class="panel">
                <div class="panel-title">
                  <h2>Il tuo diario</h2>
                  <span>{{ sessions.length }} sessioni</span>
                </div>
                <button
                  v-for="s in sessions"
                  :key="s.id"
                  class="history-item history-button"
                  @click="
                    (s.payload as TrainingSession).completedAt
                      ? (historyRecord = s)
                      : ((sessionRecord = s), (focusMode = true))
                  "
                >
                  <span
                    >{{ (s.payload as TrainingSession).name
                    }}<small
                      >{{ date((s.payload as TrainingSession).startedAt) }} ·
                      {{
                        (s.payload as TrainingSession).exercises.reduce(
                          (n, e) => n + e.actual.filter((s) => s.done).length,
                          0,
                        )
                      }}
                      serie · {{ (s.payload as TrainingSession).bodyWeight ?? '—' }} kg corporei</small
                    ></span
                  ><span class="text-lime">{{
                    (s.payload as TrainingSession).completedAt ? 'Dettagli ↗' : 'Riprendi →'
                  }}</span>
                </button>
                <div v-if="!sessions.length" class="empty">
                  Il tuo prossimo allenamento inizia qui.<br /><button
                    class="text-btn"
                    @click="view = 'oggi'"
                  >
                    Torna al tuo percorso →
                  </button>
                </div>
              </section></template
            >
            <template v-else
              ><div class="intro">
                <div>
                  <span class="eyebrow">TUTTO SOTTO CONTROLLO</span>
                  <h1>Il tuo <em>spazio.</em></h1>
                  <p>
                    {{ authSession?.user.email || 'Modalità locale · dati su questo dispositivo' }}
                  </p>
                </div>
              </div>
              <div class="program-grid">
                <section class="panel">
                  <h2>Salvataggio e sincronizzazione</h2>
                  <p v-if="!local && !authSession" class="notice">
                    Accesso da rinnovare. Puoi continuare a registrare sul dispositivo e sincronizzare dopo il
                    login.
                  </p>
                  <button v-if="!local && !authSession" class="primary" @click="reauth = true">
                    Rinnova accesso ?
                  </button>
                  <p class="subtle" role="status">{{ status }}</p>
                  <p>
                    {{ pending }} modifiche {{ local ? 'locali' : 'in attesa' }} ·
                    {{ conflicts.length }} conflitti
                  </p>
                  <p class="notice">
                    Gli allenamenti vengono salvati prima sul dispositivo. Con un account, si sincronizzano
                    all’apertura, ogni 30 secondi e al ritorno della connessione.
                  </p>
                  <div class="button-group">
                    <button v-if="!local" class="primary" @click="sync">
                      Sincronizza ora <GIcon name="arrow" /></button
                    ><button class="secondary" @click="exportData">Esporta backup</button>
                  </div>
                  <button
                    v-for="c in conflicts"
                    :key="c.id"
                    class="history-button history-item"
                    @click="conflictRecord = c"
                  >
                    {{ (c.payload as any).name || 'Pesata' }} · risolvi →
                  </button>
                  <p class="notice">
                    Il backup JSON include schede, sessioni e dati locali. Conservalo in un luogo personale.
                  </p>
                  <button class="text-btn" @click="logoutOpen = true">
                    {{ local ? 'Torna all’accesso' : 'Esci da questo dispositivo' }} →
                  </button>
                </section>
                <section class="panel">
                  <h2>Gymbrain sempre con te</h2>
                  <p class="subtle">
                    Su iPhone: apri questa app in Safari, tocca Condividi → Aggiungi alla schermata Home.
                  </p>
                  <p class="subtle">
                    Su Chrome: usa “Installa app” dal menu del browser, quando disponibile.
                  </p>
                  <p class="notice">
                    Apri l’app online almeno una volta prima di allenarti senza connessione. I video allegati
                    richiedono la rete.
                  </p>
                  <button class="secondary" @click="openEditor('weight')">Registra peso +</button>
                </section>
                <WhoopPanel
                  :info="whoop.info.value"
                  :records="whoop.records.value"
                  :links="whoop.links.value"
                  :sessions="sessions"
                  :loading="whoop.loading.value"
                  :message="whoop.message.value"
                  :online="online"
                  :local="local"
                  @connect="whoop.connect"
                  @sync="whoop.sync(false)"
                  @disconnect="whoop.disconnectOpen.value = true"
                  @link="whoop.link"
                />
                <WithingsPanel
                  :info="withings.info.value"
                  :loading="withings.loading.value"
                  :message="withings.message.value"
                  :checked="withings.checked.value"
                  :online="online"
                  :local="local"
                  @connect="withings.connect"
                  @sync="withings.syncWeights(false)"
                  @disconnect="withings.disconnectOpen.value = true"
                /></div
            ></template></div
        ></Transition>
      </div>
      <footer>MADE FOR YOUR NEXT LEVEL <span>GYMBRAIN · IL TUO RITMO</span></footer>
    </main>
    <AppModal
      :open="withings.disconnectOpen.value"
      title="Scollega Withings"
      @close="withings.disconnectOpen.value = false"
    >
      <p>Interrompi l'importazione e revochi l'accesso a Withings. Le pesate importate restano nel diario.</p>
      <button class="primary" :disabled="withings.loading.value" @click="withings.disconnect">
        Conferma scollegamento
      </button>
      <p v-if="withings.message.value" role="status">{{ withings.message.value }}</p>
    </AppModal>
    <AppModal
      :open="whoop.disconnectOpen.value"
      title="Scollega WHOOP"
      @close="whoop.disconnectOpen.value = false"
    >
      <h2>Interrompere il collegamento?</h2>
      <p>Lo storico importato rimane nel tuo diario. L'accesso a WHOOP verr? revocato.</p>
      <button class="primary" :disabled="whoop.loading.value" @click="whoop.disconnect">
        Conferma scollegamento
      </button>
      <p role="status">{{ whoop.message.value }}</p>
    </AppModal>
    <ProgramBuilder
      v-if="builderPlan"
      :key="builderPlan.id"
      :open="builderOpen"
      :owner="owner"
      :plan="builderPlan"
      :workouts="builderWorkouts"
      :catalog="catalog"
      @close="builderOpen = false"
      @draft-kept="notify('Bozza conservata sul dispositivo. Puoi riaprire il builder per completarla.')"
      @saved="sync"
    />
    <RecordEditor
      :owner="owner"
      :open="editor.open"
      :kind="editor.kind"
      :saving="savingRecord"
      :record="editor.record"
      :parent-id="editor.parentId"
      :catalog="catalog"
      @close="editor.open = false"
      @save="save"
    /><WorkoutSession
      :open="focusMode"
      :record="sessionRecord"
      :owner="owner"
      :catalog="catalog"
      @close="focusMode = false"
      @saved="sync"
      @completed="sessionComplete"
      @error="notify"
    />
    <AppModal :open="!!deleteRecord" title="ELIMINA ELEMENTO" @close="deleteRecord = null"
      ><h2>Eliminare {{ (deleteRecord?.payload as any)?.name || 'questo elemento' }}?</h2>
      <p class="notice">
        Le sessioni già registrate conservano esercizi e prescrizioni originali. Mesocicli e schede devono
        essere svuotati prima di eliminarli.
      </p>
      <button class="primary" @click="destroy">
        <GIcon name="trash" :size="18" /> Conferma eliminazione
      </button></AppModal
    >
    <AppModal :open="logoutOpen" title="IL TUO ACCOUNT" @close="logoutOpen = false"
      ><h2>{{ local ? 'Tornare all’accesso?' : 'Uscire da questo dispositivo?' }}</h2>
      <p class="notice">
        {{
          local
            ? 'I dati locali rimangono in questo browser, separati dagli account.'
            : 'La cache di questo account verrà rimossa dopo la sincronizzazione. I dati online restano nel tuo account.'
        }}
      </p>
      <p v-if="pending && !local" class="error">
        Hai {{ pending }} modifiche non sincronizzate. Sincronizzale prima di uscire.
      </p>
      <button class="primary" :disabled="!!pending && !local" @click="logout">
        {{ local ? 'Torna all’accesso' : 'Esci e rimuovi cache' }}
      </button></AppModal
    >
    <AppModal :open="!!historyRecord" title="OGNI SERIE HA UNA STORIA" wide @close="historyRecord = null"
      ><template v-if="historyRecord"
        ><h2>{{ (historyRecord.payload as TrainingSession).name }}</h2>
        <p class="subtle">
          {{ date((historyRecord.payload as TrainingSession).startedAt) }} ·
          {{ (historyRecord.payload as TrainingSession).bodyWeight ?? '—' }} kg corporei
        </p>
        <section
          v-for="e in (historyRecord.payload as TrainingSession).exercises"
          :key="e.id"
          class="prescription-editor"
        >
          <h3>{{ e.name }}</h3>
          <p v-if="e.exerciseId !== e.originalExerciseId" class="badge">
            {{ e.originalName }} → {{ e.name }} · {{ e.substitutionReason }}
          </p>
          <p class="subtle">
            {{ e.exerciseType === 'weights' ? 'Pesi' : 'Corpo libero' }} /
            {{ e.variant?.name || 'Standard' }} / {{ e.band }} / {{ e.notes }}
          </p>
          <p v-for="band in e.assistance" :key="band.id" class="notice">
            {{ band.name }}: {{ band.minKg }}–{{ band.maxKg }} kg nominali
          </p>
          <div v-for="(s, i) in e.actual" :key="i" class="history-set">
            <span>{{ i + 1 }}. {{ s.done ? '✓' : 'Non eseguita' }}</span
            ><span
              >{{ (e.measurement === 'duration' ? s.tut : s.reps) ?? '—' }}
              {{ e.measurement === 'duration' ? 's' : 'rep' }}</span
            ><span>{{ s.load ?? '—' }} kg</span><span>RPE {{ s.rpe ?? '—' }}</span
            ><span>RIR {{ s.rir ?? '—' }}</span
            ><span v-if="e.measurement !== 'duration'">{{ s.tut ?? '—' }} s TUT</span>
          </div>
          <div v-for="(set, si) in e.actual" :key="'parts-' + si">
            <p v-if="set.segments">
              Serie {{ si + 1 }} · {{ set.technique === 'cluster' ? 'Cluster' : 'Drop' }}
            </p>
            <p v-for="(part, pi) in set.segments" :key="pi">
              Passaggio {{ pi + 1 }}: {{ e.measurement === 'duration' ? part.tut : part.reps }}
              {{ e.measurement === 'duration' ? 's' : 'rep' }} · {{ part.load ?? '—' }} kg ·
              {{ part.done ? 'Completato' : 'Non completato' }}
            </p>
          </div>
          <p class="session-note">{{ e.sessionNotes }}</p>
        </section></template
      ></AppModal
    >
    <AppModal :open="!!videoUrl" title="IL MOVIMENTO, DA VICINO" wide @close="videoUrl = ''"
      ><video v-if="videoUrl" :src="videoUrl" controls playsinline class="video-player"
    /></AppModal>
    <AppModal :open="!!conflictRecord" title="DUE MODIFICHE, UNA SCELTA" wide @close="conflictRecord = null"
      ><h2>Quale versione vuoi conservare?</h2>
      <p class="notice">
        Un altro dispositivo ha modificato lo stesso elemento. Puoi esportare un backup prima di scegliere.
        Non uniamo i dati automaticamente.
      </p>
      <div class="form-grid">
        <div>
          <h3>Questo dispositivo</h3>
          <pre class="conflict-data">{{ JSON.stringify(conflictRecord?.payload, null, 2) }}</pre>
        </div>
        <div>
          <h3>Versione online</h3>
          <pre class="conflict-data">{{ JSON.stringify(conflictRecord?.conflict?.payload, null, 2) }}</pre>
        </div>
      </div>
      <div class="button-group">
        <button class="primary" @click="resolve(true)">Conserva locale</button
        ><button class="secondary" @click="resolve(false)">Usa online</button
        ><button class="text-btn" @click="exportData">Esporta backup</button>
      </div></AppModal
    >
    <div v-if="updates.available.value" class="update-banner" role="status">
      Nuova versione pronta. Si aggiornerà automaticamente quando avrai chiuso i moduli e l’allenamento.
    </div></template
  ><Transition name="toast"
    ><div v-if="toast" id="toast" popover="manual" class="show" role="status">
      {{ toast }}
    </div></Transition
  >
</template>
