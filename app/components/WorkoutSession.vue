<script setup lang="ts">
import {
  sessionSchema,
  type LocalRecord,
  type TrainingSession,
  type Exercise,
  newTarget,
} from '../../shared/domain'
import { saveRecord } from '../lib/store'
const props = defineProps<{
  open: boolean
  record: LocalRecord | null
  owner: string
  catalog: LocalRecord[]
}>()
const emit = defineEmits<{ close: []; saved: []; completed: []; error: [message: string] }>()
const draft = ref<TrainingSession | null>(null),
  index = ref(0),
  revision = ref(0),
  saving = ref(false),
  saveError = ref(''),
  restUntil = ref(0),
  now = ref(Date.now()),
  swapping = ref(false),
  replacement = ref(''),
  reason = ref(''),
  finishConfirm = ref(false)
let timer: ReturnType<typeof setInterval> | undefined,
  saveChain = Promise.resolve()
watch(
  () => props.record?.id,
  () => {
    draft.value = props.record ? JSON.parse(JSON.stringify(props.record.payload)) : null
    revision.value = props.record?.localRevision || 0
    index.value = 0
  },
  { immediate: true },
)
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 1000)
})
onUnmounted(() => clearInterval(timer))
const current = computed(() => draft.value?.exercises[index.value]),
  done = computed(
    () => draft.value?.exercises.reduce((a, e) => a + e.actual.filter((s) => s.done).length, 0) || 0,
  ),
  total = computed(() => draft.value?.exercises.reduce((a, e) => a + e.actual.length, 0) || 0),
  remaining = computed(() => Math.max(0, Math.ceil((restUntil.value - now.value) / 1000)))
function persist() {
  if (!draft.value || !props.record) return Promise.resolve(false)
  const snapshot = JSON.parse(JSON.stringify(draft.value)),
    record = props.record
  let success = false
  saving.value = true
  saveChain = saveChain
    .catch(() => {})
    .then(async () => {
      try {
        sessionSchema.parse(snapshot)
        const result = await saveRecord(props.owner, 'session', snapshot, {
          id: record.id,
          expectedRevision: revision.value,
        })
        revision.value = result.localRevision
        saveError.value = ''
        success = true
        emit('saved')
      } catch (e) {
        saveError.value = e instanceof Error ? e.message : 'Salvataggio non riuscito'
        emit('error', saveError.value)
      } finally {
        saving.value = false
      }
    })
  return saveChain.then(() => success)
}
async function close() {
  if (await persist()) emit('close')
}
function numberChange(set: any, key: string, event: Event) {
  const value = (event.target as HTMLInputElement).value
  set[key] = value === '' ? null : Number(value)
  void persist()
}
function check(i: number) {
  const s = current.value!.actual[i]!
  if (!s.done && s.reps === null && s.tut === null) {
    emit('error', 'Inserisci le ripetizioni o il TUT prima di completare la serie.')
    return
  }
  s.done = !s.done
  if (s.done) {
    now.value = Date.now()
    restUntil.value = now.value + 90000
  }
  void persist()
}
function swap() {
  const row = props.catalog.find((r) => r.id === replacement.value),
    e = current.value
  if (!row || !e) return
  const data = row.payload as Exercise
  e.exerciseId = row.id
  e.name = data.name
  e.mode = data.mode
  e.band = ''
  e.substitutionReason = reason.value
  e.actual = e.actual
    .filter((s) => s.done)
    .concat(
      Array.from({ length: Math.max(1, e.sets.length - e.actual.filter((s) => s.done).length) }, () => ({
        ...newTarget(),
        reps: null,
        rpe: null,
        rir: null,
        load: null,
        done: false,
      })),
    )
  swapping.value = false
  void persist()
}
async function complete() {
  if (!draft.value) return
  if (done.value === 0) {
    emit('error', 'Completa almeno una serie prima di concludere.')
    return
  }
  draft.value.completedAt = new Date().toISOString()
  if (await persist()) {
    finishConfirm.value = false
    emit('completed')
  } else draft.value.completedAt = null
}
const modes: Record<string, string> = {
  bodyweight: 'Corpo libero',
  weighted: 'Zavorra aggiuntiva',
  external: 'Carico esterno',
  band: 'Assistenza elastica',
}
</script>
<template>
  <AppModal :open="open" title="FOCUS MODE · IL TUO ALLENAMENTO" wide @close="close"
    ><div v-if="draft && current">
      <div class="session-progress"><b :style="{ width: (done / total) * 100 + '%' }" /></div>
      <div class="inline-top">
        <span class="subtle">{{ draft.name }} · {{ done }}/{{ total }} serie</span
        ><span class="subtle" role="status">{{
          saving ? 'Salvataggio…' : saveError ? 'Errore di salvataggio' : 'Salvato sul dispositivo'
        }}</span>
      </div>
      <label class="session-weight"
        >Peso corporeo della sessione (kg)<input
          :value="draft.bodyWeight"
          type="number"
          min="1"
          max="500"
          step=".1"
          @change="
            (e) => {
              draft!.bodyWeight =
                (e.target as HTMLInputElement).value === ''
                  ? null
                  : Number((e.target as HTMLInputElement).value)
              persist()
            }
          "
      /></label>
      <div class="exercise-tabs">
        <button
          v-for="(e, i) in draft.exercises"
          :key="e.id"
          :class="{ selected: i === index }"
          @click="index = i"
        >
          {{ i + 1 }}. {{ e.name }} {{ e.actual.every((s) => s.done) ? '✓' : '' }}
        </button>
      </div>
      <Transition name="view" mode="out-in"
        ><section :key="current.id">
          <div class="inline-top">
            <div>
              <span class="eyebrow">{{ modes[current.mode] }}</span>
              <h1>{{ current.name }}</h1>
            </div>
            <button
              class="secondary"
              @click="swapping = true; replacement = ''; reason = ''"
            >
              ⇄ Sostituisci
            </button>
          </div>
          <p v-if="current.exerciseId !== current.originalExerciseId" class="badge">
            Previsto: {{ current.originalName }} ·
            {{ current.substitutionReason || 'Sostituito in questa sessione' }}
          </p>
          <p class="session-note">{{ current.notes || 'Ascolta il movimento. Mantieni il controllo.' }}</p>
          <label v-if="current.mode === 'band'"
            >Banda e configurazione<input
              v-model="current.band"
              maxlength="200"
              placeholder="Colore, marca, numero di bande, presa…"
              @change="persist"
          /></label>
          <p class="notice">Target della scheda originale · i valori effettivi possono essere diversi</p>
          <div class="target-strip">
            <span v-for="(s, i) in current.targetSets" :key="i"
              >{{ i + 1 }}
              <b
                >{{ s.reps ?? '—' }} rep · RPE {{ s.rpe ?? '—' }} · RIR {{ s.rir ?? '—'
                }}<template v-if="s.tut !== null"> · {{ s.tut }} s</template
                ><template v-if="s.load !== null"> · {{ s.load }} kg</template></b
              ></span
            >
          </div>
          <div class="actual-grid heading">
            <span>Set</span><span>Rep</span><span>Kg¹</span><span>RPE</span><span>RIR</span><span>TUT s</span
            ><span>Fatto</span>
          </div>
          <div v-for="(s, i) in current.actual" :key="i" class="actual-grid" :class="{ completed: s.done }">
            <span>0{{ i + 1 }}</span
            ><input
              v-for="k in ['reps', 'load', 'rpe', 'rir', 'tut']"
              :key="k"
              :value="(s as any)[k]"
              :aria-label="`Serie ${i + 1} ${k}`"
              :disabled="s.done"
              type="number"
              :min="k === 'rpe' ? 1 : 0"
              :max="['rpe', 'rir'].includes(k) ? 10 : 2000"
              :step="['rpe', 'load'].includes(k) ? '.5' : 1"
              placeholder="—"
              @change="numberChange(s, k, $event)"
            /><button
              class="set-check"
              :class="{ checked: s.done }"
              :aria-pressed="s.done"
              :aria-label="`${s.done ? 'Riapri' : 'Completa'} serie ${i + 1}`"
              @click="check(i)"
            >
              {{ s.done ? '✓' : '○' }}
            </button>
          </div>
          <button
            class="text-btn"
            :disabled="current.actual.length >= 30"
            @click="current.actual.push({ reps: null, load: null, rpe: null, rir: null, tut: null, done: false }); persist()"
          >
            + Aggiungi serie effettiva
          </button>
          <p class="notice">
            ¹ Solo carico esterno o zavorra. L’assistenza elastica non viene sottratta dal peso corporeo.
          </p>
          <label
            >Note di esecuzione<textarea
              v-model="current.sessionNotes"
              rows="2"
              maxlength="4000"
              placeholder="Come ti sei sentito?"
              @change="persist"
            />
          </label></section
      ></Transition>
      <div class="session-actions">
        <button
          class="secondary timer"
          @click="now = Date.now(); restUntil = remaining ? 0 : Date.now() + 90000"
        >
          ◷
          {{
            remaining
              ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} · interrompi`
              : 'Recupero · 90 s'
          }}
        </button>
        <div class="button-group">
          <button v-if="index < draft.exercises.length - 1" class="secondary" @click="index++">
            Prossimo →</button
          ><button class="primary" :disabled="saving" @click="finishConfirm = true">
            Concludi <GIcon name="check" />
          </button>
        </div>
      </div>
      <p v-if="saveError" class="error" role="alert">{{ saveError }}</p>
    </div></AppModal
  >
  <AppModal :open="swapping" title="UN’ALTERNATIVA PER OGGI" @close="swapping = false"
    ><h2>Trova il tuo movimento.</h2>
    <p class="notice">
      La scheda resta invariata. Per mantenere lo storico chiaro, sostituisci prima di registrare le serie di
      questo esercizio.
    </p>
    <form @submit.prevent="swap">
      <label
        >Sostituzione<select v-model="replacement" required>
          <option value="">Scegli esercizio</option>
          <option v-for="e in catalog.filter((r) => r.id !== current?.exerciseId)" :key="e.id" :value="e.id">
            {{ current?.alternatives.includes(e.id) ? '★ ' : '' }}{{ (e.payload as Exercise).name }}
          </option>
        </select></label
      ><label>Motivo / note<textarea v-model="reason" maxlength="4000" rows="2" /></label>
      <p v-if="current?.actual.some((s) => s.done)" class="error">
        Hai già completato delle serie: riaprile prima di cambiare esercizio, per non attribuirle al movimento
        sostitutivo.
      </p>
      <button class="primary" :disabled="current?.actual.some((s) => s.done)" type="submit">
        Applica sostituzione <GIcon name="swap" />
      </button></form
  ></AppModal>
  <AppModal :open="finishConfirm" title="UN PASSO IN PIÙ" @close="finishConfirm = false"
    ><h2>{{ done === total ? 'Hai fatto la differenza.' : 'Concludere questa sessione?' }}</h2>
    <p class="subtle">
      {{ done }} serie completate su {{ total }}. Le serie non completate restano nello storico come non
      eseguite.
    </p>
    <button class="primary" :disabled="saving || !done" @click="complete">
      Salva allenamento <GIcon name="check" /></button
  ></AppModal>
</template>
