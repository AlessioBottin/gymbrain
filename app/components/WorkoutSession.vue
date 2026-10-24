<script setup lang="ts">
import {
  sessionSchema,
  validRecordedSet,
  type LocalRecord,
  type TrainingSession,
  type Exercise,
  newTarget,
} from '../../shared/domain';
import { trainingSequence, nextTrainingStep } from '../../shared/training';
import { effectiveTargets } from '../../shared/volume';
import { saveRecord } from '../lib/store';
const props = defineProps<{
  open: boolean;
  record: LocalRecord | null;
  owner: string;
  catalog: LocalRecord[];
}>();
const emit = defineEmits<{ close: []; saved: []; completed: []; error: [message: string] }>();
const draft = ref<TrainingSession | null>(null),
  index = ref(0),
  revision = ref(0),
  saving = ref(false),
  saveError = ref(''),
  restUntil = ref(0),
  restDuration = ref(90),
  now = ref(Date.now()),
  swapping = ref(false),
  replacement = ref(''),
  reason = ref(''),
  finishConfirm = ref(false);
let timer: ReturnType<typeof setInterval> | undefined,
  saveChain = Promise.resolve();
watch(
  () => props.record?.id,
  () => {
    draft.value = props.record ? sessionSchema.parse(JSON.parse(JSON.stringify(props.record.payload))) : null;
    revision.value = props.record?.localRevision || 0;
    restUntil.value = 0;
    restDuration.value = 90;
    index.value = draft.value ? (nextTrainingStep(draft.value)?.exercise ?? 0) : 0;
  },
  { immediate: true },
);
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => clearInterval(timer));
const current = computed(() => draft.value?.exercises[index.value]),
  done = computed(
    () => draft.value?.exercises.reduce((a, e) => a + e.actual.filter((s) => s.done).length, 0) || 0,
  ),
  total = computed(() => draft.value?.exercises.reduce((a, e) => a + e.actual.length, 0) || 0),
  remaining = computed(() => Math.max(0, Math.ceil((restUntil.value - now.value) / 1000)));
function persist() {
  if (!draft.value || !props.record) return Promise.resolve(false);
  const snapshot = JSON.parse(JSON.stringify(draft.value)),
    record = props.record;
  let success = false;
  saving.value = true;
  saveChain = saveChain
    .catch(() => {})
    .then(async () => {
      try {
        sessionSchema.parse(snapshot);
        const result = await saveRecord(props.owner, 'session', snapshot, {
          id: record.id,
          expectedRevision: revision.value,
        });
        revision.value = result.localRevision;
        saveError.value = '';
        success = true;
        emit('saved');
      } catch (e) {
        saveError.value = e instanceof Error ? e.message : 'Salvataggio non riuscito';
        emit('error', saveError.value);
      } finally {
        saving.value = false;
      }
    });
  return saveChain.then(() => success);
}
async function close() {
  if (await persist()) emit('close');
}
function numberChange(set: any, key: string, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  set[key] = value === '' ? null : Number(value);
  void persist();
}
const suggested = computed(() => (draft.value ? nextTrainingStep(draft.value) : undefined));
function completeSegment(setIndex: number, partIndex: number) {
  const set = current.value?.actual[setIndex],
    part = set?.segments?.[partIndex];
  if (!set || !part || set.done) return;
  if (!part.done && !validRecordedSet(part, current.value?.measurement)) {
    emit('error', 'Inserisci ripetizioni o secondi validi per il passaggio.');
    return;
  }
  part.done = !part.done;
  if (part.done) {
    now.value = Date.now();
    const last = partIndex === set.segments!.length - 1;
    restDuration.value = !last && set.technique === 'cluster' ? (part.restSeconds ?? 20) : 0;
    restUntil.value =
      now.value + (!last && set.technique === 'cluster' ? (part.restSeconds ?? 20) : 0) * 1000;
    if (set.segments!.every((s) => s.done)) {
      check(setIndex);
      return;
    }
  }
  void persist();
}
function check(i: number) {
  const s = current.value!.actual[i]!;
  if (!s.done && !validRecordedSet(s, current.value!.measurement)) {
    emit(
      'error',
      current.value!.measurement === 'duration'
        ? 'Inserisci una durata maggiore di zero secondi.'
        : 'Inserisci un numero intero di ripetizioni maggiore di zero.',
    );
    return;
  }
  s.done = !s.done;
  if (s.done && draft.value) {
    const step = trainingSequence(draft.value.exercises.map((e) => ({ ...e, sets: e.actual }))).find(
      (step) => step.exercise === index.value && step.set === i,
    );
    now.value = Date.now();
    restDuration.value = step?.restSeconds ?? 90;
    restUntil.value = now.value + restDuration.value * 1000;
    const next = nextTrainingStep(draft.value);
    if (next && current.value?.group) index.value = next.exercise;
  }
  void persist();
}
const currentVariants = computed(
  () =>
    (props.catalog.find((r) => r.id === current.value?.exerciseId)?.payload as Exercise | undefined)
      ?.variants || [],
);
function changeVariant(id: string) {
  if (!current.value || current.value.actual.some((s) => s.done || s.segments?.some((p) => p.done))) return;
  const v = currentVariants.value.find((v) => v.id === id);
  const source = props.catalog.find((r) => r.id === current.value!.exerciseId)?.payload as
    | Exercise
    | undefined;
  current.value.muscleTargets = effectiveTargets(source?.muscleTargets, v?.muscleTargets);
  current.value.variant = v ? { ...v, muscleTargets: {} } : null;
  void persist();
}
function changeAssistance(bands: TrainingSession['exercises'][number]['assistance']) {
  if (!current.value) return;
  current.value.assistance = bands;
  void persist();
}
function swap() {
  const row = props.catalog.find((r) => r.id === replacement.value),
    e = current.value;
  if (!row || !e) return;
  const data = row.payload as Exercise;
  e.muscleTargets = { ...data.muscleTargets };
  e.exerciseId = row.id;
  e.name = data.name;
  e.exerciseType = data.exerciseType;
  e.measurement = data.measurement || 'reps';
  e.mode = data.exerciseType === 'weights' ? 'external' : 'bodyweight';
  e.variant = null;
  e.assistance = [];
  e.band = '';
  e.substitutionReason = reason.value;
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
    );
  swapping.value = false;
  void persist();
}
async function complete() {
  if (!draft.value) return;
  if (
    draft.value.exercises.some((e) => e.actual.some((s) => s.done && !validRecordedSet(s, e.measurement)))
  ) {
    emit('error', 'Correggi le serie registrate: ripetizioni o durata devono essere maggiori di zero.');
    return;
  }
  if (done.value === 0) {
    emit('error', 'Completa almeno una serie prima di concludere.');
    return;
  }
  draft.value.completedAt = new Date().toISOString();
  if (await persist()) {
    finishConfirm.value = false;
    emit('completed');
  } else draft.value.completedAt = null;
}
const modes: Record<string, string> = {
  bodyweight: 'Corpo libero',
  weighted: 'Zavorra aggiuntiva',
  external: 'Carico esterno',
  band: 'Assistenza elastica',
};
</script>
<template>
  <AppModal :open="open" title="FOCUS MODE · IL TUO ALLENAMENTO" wide @close="close"
    ><div v-if="draft && current">
      <p v-if="suggested" class="notice">
        Prossimo: {{ draft.exercises[suggested.exercise]?.name }} · serie {{ suggested.set + 1
        }}<button class="text-btn" @click="index = suggested.exercise">Vai all'esercizio</button>
      </p>
      <p v-if="current.group" class="badge">
        {{ current.group.type === 'jump' ? 'Jump set' : 'Superset' }} · recupero
        {{ current.group.restSeconds }} s {{ current.group.type === 'jump' ? 'tra esercizi' : 'tra giri' }}
      </p>
      <p class="session-step">
        Esercizio {{ index + 1 }} di {{ draft.exercises.length }} ?
        {{ current.actual.filter((s) => s.done).length }} / {{ current.actual.length }} serie completate
      </p>
      <div class="session-progress"><b :style="{ width: (done / total) * 100 + '%' }" /></div>
      <div class="inline-top">
        <span class="subtle">{{ draft.name }} · {{ done }}/{{ total }} serie</span
        ><span class="subtle" role="status">{{
          saving ? 'Salvataggio…' : saveError ? 'Errore di salvataggio' : 'Progressi salvati'
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
                  : Number((e.target as HTMLInputElement).value);
              persist();
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
              <span class="eyebrow">{{ current.exerciseType === 'weights' ? 'Pesi' : 'Corpo libero' }}</span>
              <h1>
                {{ current.name }}<small v-if="current.variant"> / {{ current.variant.name }}</small>
              </h1>
            </div>
            <button
              class="secondary"
              @click="
                swapping = true;
                replacement = '';
                reason = '';
              "
            >
              ⇄ Sostituisci
            </button>
          </div>
          <p v-if="current.exerciseId !== current.originalExerciseId" class="badge">
            Previsto: {{ current.originalName
            }}{{ current.originalVariant ? ' / ' + current.originalVariant.name : '' }} ·
            {{ current.substitutionReason || 'Sostituito in questa sessione' }}
          </p>
          <p class="session-note">
            {{ current.notes || 'Ascolta il movimento. Mantieni il controllo.' }}
          </p>
          <label
            >Variante del movimento<select
              :value="current.variant?.id || ''"
              @change="changeVariant(($event.target as HTMLSelectElement).value)"
            >
              <option value="">Standard</option>
              <option
                v-if="current.variant && !currentVariants.some((v) => v.id === current?.variant?.id)"
                :value="current.variant.id"
              >
                {{ current.variant.name }} (salvata)
              </option>
              <option v-for="v in currentVariants" :key="v.id" :value="v.id">{{ v.name }}</option>
            </select></label
          >
          <p v-if="current.variant?.notes" class="notice">{{ current.variant.notes }}</p>
          <AssistancePicker
            v-if="current.exerciseType === 'bodyweight'"
            :model-value="current.assistance"
            @update:model-value="changeAssistance"
          />
          <label v-if="current.exerciseType === 'bodyweight'"
            >Banda e configurazione<input
              v-model="current.band"
              maxlength="200"
              @change="persist"
              placeholder="Punto di ancoraggio, piede o ginocchio"
          /></label>
          <p class="notice">Target della scheda originale · i valori effettivi possono essere diversi</p>
          <div class="target-strip">
            <span v-for="(s, i) in current.targetSets" :key="i"
              >{{ i + 1 }}
              <b
                >{{ (current.measurement === 'duration' ? s.tut : s.reps) ?? '—' }}
                {{ current.measurement === 'duration' ? 's' : 'rep' }} · RPE {{ s.rpe ?? '—' }} · RIR
                {{ s.rir ?? '—'
                }}<template v-if="s.tut !== null && current.measurement !== 'duration'">
                  · {{ s.tut }} s</template
                ><template v-if="s.load !== null"> · {{ s.load }} kg</template></b
              ></span
            >
          </div>
          <div v-for="(set, si) in current.actual" :key="'technique-' + si">
            <fieldset v-if="set.segments?.length">
              <legend>
                Serie {{ si + 1 }} · {{ set.technique === 'cluster' ? 'Cluster set' : 'Drop set' }}
              </legend>
              <div v-for="(part, pi) in set.segments" :key="pi" class="form-grid">
                <p>
                  Passaggio {{ pi + 1 }} · target
                  {{
                    current.targetSets[si]?.segments?.[pi]?.reps ??
                    current.targetSets[si]?.segments?.[pi]?.tut ??
                    '—'
                  }}
                  · {{ current.targetSets[si]?.segments?.[pi]?.load ?? '—' }} kg
                </p>
                <label
                  >{{ current.measurement === 'duration' ? 'Secondi' : 'Ripetizioni'
                  }}<StableNumberInput
                    :value="current.measurement === 'duration' ? part.tut : part.reps"
                    :disabled="part.done || set.done"
                    min="1"
                    max="2000"
                    @commit="
                      current.measurement === 'duration' ? (part.tut = $event) : (part.reps = $event);
                      persist();
                    "
                /></label>
                <label
                  >Kg effettivi<StableNumberInput
                    :value="part.load"
                    :disabled="part.done || set.done"
                    min="0"
                    max="2000"
                    step="0.5"
                    @commit="
                      part.load = $event;
                      persist();
                    "
                /></label>
                <button
                  class="secondary"
                  :disabled="set.done || (pi > 0 && !set.segments[pi - 1]?.done)"
                  @click="completeSegment(si, pi)"
                >
                  {{ part.done ? 'Riapri' : 'Completa' }} passaggio {{ pi + 1 }}
                </button>
              </div>
            </fieldset>
          </div>
          <div class="actual-grid heading" :class="{ isometric: current.measurement === 'duration' }">
            <span>Set</span><span>{{ current.measurement === 'duration' ? 'Secondi' : 'Rep' }}</span
            ><span>Kg¹</span><span>RPE</span><span>RIR</span
            ><span v-if="current.measurement !== 'duration'">TUT s</span><span>Fatto</span>
          </div>
          <div
            v-for="(s, i) in current.actual"
            :key="i"
            class="actual-grid"
            :class="{ completed: s.done, isometric: current.measurement === 'duration' }"
          >
            <span class="set-number">Serie {{ i + 1 }}</span
            ><label
              class="actual-field"
              v-for="k in s.segments?.length
                ? ['rpe', 'rir']
                : current.measurement === 'duration'
                  ? ['tut', 'load', 'rpe', 'rir']
                  : ['reps', 'load', 'rpe', 'rir', 'tut']"
              :key="k"
              ><span>{{
                (
                  {
                    reps: 'Ripetizioni',
                    load: 'Kg',
                    rpe: 'RPE',
                    rir: 'RIR',
                    tut: current.measurement === 'duration' ? 'Secondi' : 'TUT s',
                  } as any
                )[k]
              }}</span
              ><StableNumberInput
                :value="(s as any)[k]"
                :aria-label="`Serie ${i + 1} ${k}`"
                :disabled="s.done"
                type="number"
                :min="
                  k === 'rpe' || k === 'reps' || (k === 'tut' && current.measurement === 'duration') ? 1 : 0
                "
                :max="['rpe', 'rir'].includes(k) ? 10 : 2000"
                :step="['rpe', 'load'].includes(k) ? '.5' : 1"
                placeholder="—"
                @commit="
                  (s as any)[k] = $event;
                  persist();
                " /></label
            ><button
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
            @click="
              current.actual.push({
                reps: null,
                load: null,
                rpe: null,
                rir: null,
                tut: null,
                done: false,
              });
              persist();
            "
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
          @click="
            now = Date.now();
            restUntil = remaining ? 0 : Date.now() + restDuration * 1000;
          "
        >
          ◷
          {{
            remaining
              ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} · interrompi`
              : restDuration
                ? `Recupero · ${restDuration} s`
                : 'Nessuna pausa: prossimo esercizio'
          }}
        </button>
        <div class="button-group">
          <button v-if="index > 0" class="secondary" @click="index--">? Precedente</button>
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
