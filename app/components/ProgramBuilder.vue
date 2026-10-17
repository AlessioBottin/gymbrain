<script setup lang="ts">
import {
  workoutSchema,
  prescriptionSchema,
  newTarget,
  type LocalRecord,
  type Workout,
  type Exercise,
  type Prescription,
} from '../../shared/domain';
import { makePrescription } from '../../shared/volume';
import { savePlanWorkouts } from '../lib/store';
const props = defineProps<{
  open: boolean;
  owner: string;
  plan: LocalRecord;
  workouts: LocalRecord[];
  catalog: LocalRecord[];
}>();
const emit = defineEmits<{ close: []; saved: [] }>();
type Day = { id: string; revision?: number; payload: Workout };
const days = ref<Day[]>([]),
  saving = ref(false),
  error = ref('');
const pickerDayId = ref(''),
  pickerSearch = ref('');
const flowStage = ref<'exercise' | 'variant' | 'sets' | 'destination'>('exercise');
const candidateRow = ref<LocalRecord>();
const editExercises = ref<Prescription[]>([]),
  editIndex = ref(0),
  editingExisting = ref(false);
const settingsError = ref('');
const destinationDayId = ref('');
const dayMenuOpen = ref(false);
const pickerDay = computed(() => days.value.find((day) => day.id === pickerDayId.value));
const editExercise = computed(() => editExercises.value[editIndex.value]);
const pickerExercises = computed(() => {
  const query = pickerSearch.value.trim().toLocaleLowerCase('it-IT');
  return props.catalog.filter((row) =>
    (row.payload as Exercise).name.toLocaleLowerCase('it-IT').includes(query),
  );
});
const candidateVariants = computed(
  () => (candidateRow.value?.payload as Exercise | undefined)?.variants || [],
);
const flowTitle = computed(() =>
  flowStage.value === 'exercise'
    ? 'AGGIUNGI ESERCIZIO'
    : flowStage.value === 'variant'
      ? 'SCEGLI LA VARIANTE'
      : flowStage.value === 'destination'
        ? 'SCEGLI LA GIORNATA'
        : 'IMPOSTA LE SERIE',
);
function openExercisePicker(day: Day) {
  destinationDayId.value = '';
  pickerSearch.value = '';
  candidateRow.value = undefined;
  flowStage.value = 'exercise';
  editingExisting.value = false;
  settingsError.value = '';
  pickerDayId.value = day.id;
}
function addToPickerDay(row: LocalRecord) {
  if (!pickerDay.value) return;
  candidateRow.value = row;
  if ((row.payload as Exercise).variants?.length) flowStage.value = 'variant';
  else prepareNewExercise();
}
function prepareNewExercise(variantId = '') {
  if (!pickerDay.value || !candidateRow.value) return;
  const exercise = makePrescription(candidateRow.value);
  const variant = candidateVariants.value.find((v) => v.id === variantId);
  exercise.variant = variant ? JSON.parse(JSON.stringify(variant)) : null;
  editExercises.value = JSON.parse(JSON.stringify(pickerDay.value.payload.exercises));
  editIndex.value = editExercises.value.length;
  editExercises.value.push(exercise);
  editingExisting.value = false;
  settingsError.value = '';
  flowStage.value = 'sets';
}
function openSetEditor(day: Day, index: number) {
  destinationDayId.value = '';
  editingExisting.value = true;
  candidateRow.value = undefined;
  editExercises.value = JSON.parse(JSON.stringify(day.payload.exercises));
  editIndex.value = index;
  settingsError.value = '';
  flowStage.value = 'sets';
  pickerDayId.value = day.id;
}
function applyExerciseSettings() {
  try {
    if (!pickerDay.value || !editExercise.value) return;
    const valid = editExercises.value.map((e) => prescriptionSchema.parse(e));
    if (!editingExisting.value && pickerDay.value.payload.exercises.length >= 50)
      throw new Error('Una giornata ha raggiunto il limite di 50 esercizi.');
    if (destinationDayId.value && destinationDayId.value !== pickerDay.value.id) {
      const target = days.value.find((d) => d.id === destinationDayId.value);
      if (!target || target.payload.exercises.length >= 50)
        throw new Error('La giornata di destinazione non ha spazio disponibile.');
      const [moved] = valid.splice(editIndex.value, 1);
      target.payload.exercises.push({ ...moved!, group: undefined });
      clearOrphanGroups(valid);
    }
    pickerDay.value.payload.exercises = valid;
    pickerDayId.value = '';
  } catch (e) {
    settingsError.value = e instanceof Error ? e.message : 'Controlla i valori delle serie.';
  }
}
const weekdays = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const key = computed(() => `gymbrain-draft:${props.owner}:builder:${props.plan.id}`);
const allExercises = computed(() => days.value.flatMap((d) => d.payload.exercises));
watch(
  () => props.open,
  (value) => {
    pickerDayId.value = '';
    if (!value) return;
    error.value = '';
    days.value = props.workouts.map((r) => ({
      id: r.id,
      revision: r.localRevision,
      payload: workoutSchema.parse(JSON.parse(JSON.stringify(r.payload))),
    }));
    savedContent.value = content.value;
    dayMenuOpen.value = false;
    try {
      const saved = JSON.parse(localStorage.getItem(key.value) || 'null');
      if (Array.isArray(saved)) days.value = saved;
    } catch {
      error.value = 'Bozza non leggibile. Sono disponibili le giornate salvate.';
    }
  },
);
const content = computed(() => JSON.stringify(days.value.map(({ id, payload }) => ({ id, payload }))));
const savedContent = ref('');
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave: Promise<boolean> | undefined;
const saveStatus = computed(() =>
  saving.value
    ? 'Salvataggio automatico…'
    : error.value
      ? 'Modifiche da completare'
      : content.value !== savedContent.value
        ? 'Modifiche in attesa…'
        : 'Salvato sul dispositivo',
);
function persistDraft() {
  try {
    localStorage.setItem(key.value, JSON.stringify(days.value));
  } catch {
    error.value = 'Spazio locale non disponibile.';
  }
}
watch(content, () => {
  if (!props.open) return;
  persistDraft();
  clearTimeout(saveTimer);
  if (content.value !== savedContent.value)
    saveTimer = setTimeout(() => {
      void save();
    }, 600);
});
onBeforeUnmount(() => clearTimeout(saveTimer));
async function closeBuilder() {
  clearTimeout(saveTimer);
  if (pendingSave) await pendingSave;
  if (await save()) emit('close');
}
function resetDraft() {
  days.value = props.workouts.map((r) => ({
    id: r.id,
    revision: r.localRevision,
    payload: workoutSchema.parse(JSON.parse(JSON.stringify(r.payload))),
  }));
  savedContent.value = content.value;
  error.value = '';
}
function addDay(name: string) {
  const day = {
    id: crypto.randomUUID(),
    payload: { name, notes: '', order: days.value.length, exercises: [] },
  };
  days.value.push(day);
  dayMenuOpen.value = false;
}
function variants(e: Prescription) {
  return (props.catalog.find((r) => r.id === e.exerciseId)?.payload as Exercise | undefined)?.variants || [];
}
function chooseVariant(e: Prescription, event: Event) {
  const variant = variants(e).find((v) => v.id === (event.target as HTMLSelectElement).value);
  e.variant = variant ? JSON.parse(JSON.stringify(variant)) : null;
}
function clearOrphanGroups(exercises: Prescription[]) {
  for (const exercise of exercises)
    if (exercise.group && exercises.filter((e) => e.group?.id === exercise.group?.id).length < 2)
      exercise.group = undefined;
}
function reorderExercise(day: Day, index: number, offset: number) {
  const next = index + offset;
  const exercises = day.payload.exercises;
  if (next < 0 || next >= exercises.length) return;
  [exercises[index], exercises[next]] = [exercises[next]!, exercises[index]!];
}
function removeExercise() {
  if (!pickerDay.value || !editExercise.value) return;
  pickerDay.value.payload.exercises = pickerDay.value.payload.exercises.filter(
    (e) => e.id !== editExercise.value!.id,
  );
  clearOrphanGroups(pickerDay.value.payload.exercises);
  pickerDayId.value = '';
}
function setCount(e: Prescription, event: Event) {
  const count = Number((event.target as HTMLInputElement).value);
  if (!Number.isInteger(count) || count < 1 || count > 30) return;
  while (e.sets.length < count)
    e.sets.push(JSON.parse(JSON.stringify(e.sets.at(-1) || newTarget(e.measurement))));
  e.sets.splice(count);
}
function repsSummary(e: Prescription) {
  return [
    ...new Set(
      e.sets.map((s) =>
        s.segments?.length
          ? s.segments.map((p) => (e.measurement === 'duration' ? p.tut : p.reps) ?? '—').join('+')
          : String((e.measurement === 'duration' ? s.tut : s.reps) ?? '—'),
      ),
    ),
  ].join(' / ');
}
function techniqueSummary(e: Prescription) {
  const labels: string[] = [
    ...new Set(
      e.sets.map((s) =>
        s.technique === 'cluster' ? 'Cluster' : s.technique === 'drop' ? 'Drop' : 'Standard',
      ),
    ),
  ];
  if (e.group) labels.unshift(e.group.type === 'jump' ? 'Jump set' : 'Superset');
  return labels.join(' · ');
}
async function save(): Promise<boolean> {
  if (pendingSave) return pendingSave;
  if (content.value === savedContent.value) return true;
  const snapshot = JSON.parse(JSON.stringify(days.value)) as Day[];
  const snapshotContent = content.value;
  saving.value = true;
  error.value = '';
  pendingSave = (async () => {
    try {
      const rows = await savePlanWorkouts(props.owner, props.plan.id, snapshot);
      for (const row of rows) {
        const day = days.value.find((d) => d.id === row.id);
        if (day) day.revision = row.localRevision;
      }
      savedContent.value = snapshotContent;
      persistDraft();
      if (content.value === savedContent.value) localStorage.removeItem(key.value);
      emit('saved');
      return true;
    } catch (e) {
      error.value =
        e instanceof Error
          ? 'issues' in e
            ? 'Completa i dati delle giornate: ogni gruppo deve contenere almeno due esercizi e valori validi.'
            : e.message
          : 'Salvataggio non riuscito';
      return false;
    } finally {
      saving.value = false;
      pendingSave = undefined;
      if (!error.value && content.value !== savedContent.value) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          void save();
        }, 600);
      }
    }
  })();
  return pendingSave;
}
</script>
<template>
  <AppModal :open="open" title="BUILDER DELLA SCHEDA" wide @close="closeBuilder">
    <form v-if="open" class="program-builder" @submit.prevent>
      <header class="builder-toolbar">
        <div>
          <h2>{{ (plan.payload as any).name }}</h2>
          <p class="draft-status">
            {{ (plan.payload as any).start || 'Periodo da impostare'
            }}<template v-if="(plan.payload as any).end"> → {{ (plan.payload as any).end }}</template>
          </p>
        </div>
        <button type="button" class="primary" @click="dayMenuOpen = true">
          <GIcon name="plus" /> Aggiungi giornata
        </button>
      </header>
      <p role="status" class="draft-status">{{ saveStatus }}</p>
      <p v-if="!catalog.length">Crea i tuoi esercizi nel catalogo per aggiungerli qui.</p>
      <div class="builder-layout">
        <div class="builder-board" role="region" aria-label="Giornate della scheda affiancate" tabindex="0">
          <div class="builder-days">
            <section v-for="day in days" :key="day.id" class="builder-day">
              <div class="builder-day-heading">
                <label class="builder-day-name"
                  >Giornata<input v-model="day.payload.name" maxlength="100" required
                /></label>
                <button
                  type="button"
                  class="icon-btn builder-day-add"
                  :aria-label="`Aggiungi esercizio a ${day.payload.name}`"
                  title="Aggiungi esercizio"
                  :disabled="day.payload.exercises.length >= 50"
                  @click="openExercisePicker(day)"
                >
                  <GIcon name="plus" :size="22" />
                </button>
              </div>
              <p class="builder-day-meta">
                {{ day.payload.exercises.length }} esercizi ·
                {{ day.payload.exercises.reduce((n, e) => n + e.sets.length, 0) }} serie
              </p>
              <details class="builder-day-notes">
                <summary>Note giornata</summary>
                <textarea v-model="day.payload.notes" aria-label="Note giornata" maxlength="4000" rows="2" />
              </details>
              <article v-for="(e, i) in day.payload.exercises" :key="e.id" class="builder-exercise">
                <h3>{{ i + 1 }}. {{ e.name }}</h3>
                <p v-if="e.variant" class="builder-variant">{{ e.variant.name }}</p>
                <span class="builder-technique">{{ techniqueSummary(e) }}</span>
                <p class="builder-prescription">
                  <strong>{{ e.sets.length }} × {{ repsSummary(e) }}</strong>
                  {{ e.measurement === 'duration' ? 's' : 'rep' }}
                </p>
                <div class="builder-exercise-actions">
                  <button
                    type="button"
                    class="icon-btn"
                    :aria-label="`Modifica serie di ${e.name}`"
                    title="Modifica serie"
                    @click="openSetEditor(day, i)"
                  >
                    <GIcon name="edit" :size="18" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    :aria-label="`Sposta su ${e.name}`"
                    title="Sposta su"
                    :disabled="i === 0"
                    @click="reorderExercise(day, i, -1)"
                  >
                    <GIcon name="arrowUp" :size="18" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    :aria-label="`Sposta giù ${e.name}`"
                    title="Sposta giù"
                    :disabled="i === day.payload.exercises.length - 1"
                    @click="reorderExercise(day, i, 1)"
                  >
                    <GIcon name="arrowDown" :size="18" />
                  </button>
                </div>
              </article>
              <p v-if="!day.payload.exercises.length" class="notice">
                Premi + per scegliere gli esercizi di questa giornata.
              </p>
            </section>
          </div>
        </div>
        <section class="builder-recap" aria-label="Volume totale della scheda">
          <h3>Recap scheda</h3>
          <VolumeSummary :exercises="allExercises" :catalog="catalog" />
          <p class="notice">
            I target non impostati nel catalogo contano 0. Cluster e drop contano una serie per tutti i
            passaggi.
          </p>
        </section>
      </div>
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="button" class="text-btn" :disabled="saving" @click="resetDraft">
        Riparti dalle giornate salvate
      </button>
    </form>
  </AppModal>
  <AppModal :open="open && dayMenuOpen" title="AGGIUNGI GIORNATA" @close="dayMenuOpen = false">
    <div class="button-group">
      <button
        v-for="day in weekdays"
        :key="day"
        type="button"
        class="secondary"
        :disabled="days.some((d) => d.payload.name === day)"
        @click="addDay(day)"
      >
        + {{ day }}
      </button>
      <button type="button" class="secondary" @click="addDay('Giornata ' + (days.length + 1))">
        + Giornata personalizzata
      </button>
    </div>
  </AppModal>
  <AppModal :open="open && !!pickerDay" :title="flowTitle" @close="pickerDayId = ''">
    <div v-if="pickerDay" class="builder-picker">
      <h2>{{ pickerDay.payload.name }}</h2>
      <template v-if="flowStage === 'exercise'">
        <label
          >Cerca esercizio<input
            v-model="pickerSearch"
            type="search"
            placeholder="Nome dell'esercizio"
            autofocus
        /></label>
        <p class="notice">Scegli un esercizio per aggiungerlo a questa giornata.</p>
        <p v-if="!catalog.length" role="status">
          Il catalogo è vuoto. Crea prima i tuoi esercizi nella sezione Esercizi.
        </p>
        <p v-else-if="!pickerExercises.length" role="status">Nessun esercizio trovato.</p>
        <div class="builder-picker-list">
          <button
            v-for="row in pickerExercises"
            :key="row.id"
            type="button"
            class="builder-picker-item"
            :aria-label="`Aggiungi ${(row.payload as Exercise).name}`"
            :disabled="pickerDay.payload.exercises.length >= 50"
            @click="addToPickerDay(row)"
          >
            <span
              ><strong>{{ (row.payload as Exercise).name }}</strong
              ><small>{{
                (row.payload as Exercise).exerciseType === 'weights' ? 'Pesi' : 'Corpo libero'
              }}</small></span
            ><GIcon name="plus" />
          </button>
        </div>
      </template>
      <template v-else-if="flowStage === 'variant'">
        <h3>{{ (candidateRow?.payload as Exercise)?.name }}</h3>
        <p class="notice">Scegli la variante o usa l'esercizio standard.</p>
        <div class="builder-picker-list">
          <button type="button" class="builder-picker-item" @click="prepareNewExercise()">
            <strong>Standard</strong>
          </button>
          <button
            v-for="variant in candidateVariants"
            :key="variant.id"
            type="button"
            class="builder-picker-item"
            @click="prepareNewExercise(variant.id)"
          >
            <span
              ><strong>{{ variant.name }}</strong
              ><small v-if="variant.notes">{{ variant.notes }}</small></span
            ><GIcon name="arrow" />
          </button>
        </div>
        <button type="button" class="text-btn" @click="flowStage = 'exercise'">Cambia esercizio</button>
      </template>
      <template v-else-if="flowStage === 'destination'">
        <p>Scegli dove spostare {{ editExercise?.name }}.</p>
        <div class="builder-picker-list">
          <button
            v-for="day in days.filter((d) => d.id !== pickerDayId)"
            :key="day.id"
            type="button"
            class="builder-picker-item"
            :disabled="day.payload.exercises.length >= 50"
            @click="
              destinationDayId = day.id;
              flowStage = 'sets';
            "
          >
            {{ day.payload.name }}
          </button>
        </div>
        <button type="button" class="secondary" @click="flowStage = 'sets'">Indietro</button>
      </template>
      <form v-else-if="editExercise" @submit.prevent="applyExerciseSettings" class="builder-set-form">
        <h3>
          {{ editExercise.name }}<span v-if="editExercise.variant"> · {{ editExercise.variant.name }}</span>
        </h3>
        <div v-if="editingExisting" class="builder-organize">
          <div class="button-group">
            <button
              type="button"
              class="secondary"
              :disabled="days.length < 2"
              @click="flowStage = 'destination'"
            >
              Sposta in un'altra giornata
            </button>
            <button type="button" class="text-btn danger" @click="removeExercise">Rimuovi esercizio</button>
          </div>
          <p v-if="destinationDayId" role="status">
            Destinazione: {{ days.find((d) => d.id === destinationDayId)?.payload.name }}. Lo spostamento
            avviene alla conferma.
            <button type="button" class="text-btn" @click="destinationDayId = ''">Annulla spostamento</button>
          </p>
        </div>
        <label v-if="variants(editExercise).length || editExercise.variant"
          >Variante<select
            :value="editExercise.variant?.id || ''"
            @change="chooseVariant(editExercise, $event)"
          >
            <option value="">Standard</option>
            <option
              v-if="
                editExercise.variant &&
                !variants(editExercise).some((v) => v.id === editExercise?.variant?.id)
              "
              :value="editExercise.variant.id"
            >
              {{ editExercise.variant.name }} (salvata)
            </option>
            <option v-for="v in variants(editExercise)" :key="v.id" :value="v.id">{{ v.name }}</option>
          </select></label
        >
        <label
          >Numero di serie<input
            type="number"
            :value="editExercise.sets.length"
            min="1"
            max="30"
            required
            @change="setCount(editExercise, $event)"
        /></label>
        <ExerciseGroup :exercise="editExercise" :exercises="editExercises" />
        <label>Note esercizio<textarea v-model="editExercise.notes" maxlength="4000" rows="2" /></label>
        <AssistancePicker
          v-if="editExercise.exerciseType === 'bodyweight'"
          v-model="editExercise.assistance"
        />
        <fieldset v-for="(set, index) in editExercise.sets" :key="index" class="builder-set">
          <legend>Serie {{ index + 1 }}</legend>
          <label class="builder-check"
            ><input
              type="checkbox"
              :checked="set.countVolume !== false"
              @change="set.countVolume = ($event.target as HTMLInputElement).checked"
            />Includi nel volume</label
          >
          <div class="form-grid">
            <label v-if="!set.segments?.length"
              >{{ editExercise.measurement === 'duration' ? 'Secondi' : 'Ripetizioni'
              }}<StableNumberInput
                :value="editExercise.measurement === 'duration' ? set.tut : set.reps"
                :min="1"
                :max="2000"
                :step="1"
                @commit="editExercise.measurement === 'duration' ? (set.tut = $event) : (set.reps = $event)"
            /></label>
            <label v-if="!set.segments?.length"
              >{{ editExercise.exerciseType === 'weights' ? 'Carico (kg)' : 'Sovraccarico (kg)'
              }}<StableNumberInput
                :value="set.load"
                :min="0"
                :max="2000"
                :step="0.5"
                @commit="set.load = $event"
            /></label>
            <label
              >RPE<StableNumberInput
                :value="set.rpe"
                :min="1"
                :max="10"
                :step="0.5"
                @commit="set.rpe = $event"
            /></label>
            <label
              >RIR<StableNumberInput :value="set.rir" :min="0" :max="10" :step="1" @commit="set.rir = $event"
            /></label>
          </div>
          <SetTechnique :set="set" :measurement="editExercise.measurement" />
        </fieldset>
        <p v-if="settingsError" role="alert">{{ settingsError }}</p>
        <div class="button-group">
          <button type="button" class="secondary" @click="pickerDayId = ''">Annulla</button
          ><button type="submit" class="primary">
            {{ editingExisting ? 'Conferma modifiche' : 'Aggiungi alla scheda' }}
          </button>
        </div>
      </form>
    </div>
  </AppModal>
</template>
<style scoped>
.builder-exercise-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 6px;
}
.builder-exercise-actions .icon-btn {
  color: var(--lime);
  border: 1px solid var(--line);
}
.builder-exercise-actions .icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.builder-set-form .builder-check input {
  width: auto;
}
.builder-set-form .builder-set {
  padding: 12px;
  margin: 16px 0;
  border: 1px solid var(--line);
  border-radius: 10px;
}

.builder-day-heading {
  display: flex;
  align-items: end;
  gap: 8px;
}
.builder-day-heading .builder-day-name {
  flex: 1;
  min-width: 0;
}
.builder-day-add {
  flex: none;
  width: 38px;
  height: 38px;
  margin-bottom: 5px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--lime);
}
.builder-picker h2 {
  margin: 8px 0;
}
.builder-picker-list {
  display: grid;
  gap: 8px;
  max-height: 50dvh;
  overflow-y: auto;
}
.builder-picker-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 14px;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}
.builder-picker-item strong,
.builder-picker-item small {
  display: block;
}
.builder-picker-item strong {
  overflow-wrap: anywhere;
}
.builder-picker-item small {
  color: var(--muted);
  margin-top: 4px;
}
.builder-picker-item:hover {
  border-color: var(--lime);
}

.builder-toolbar {
  height: auto;
  min-height: 50px;
  border: 0;
  padding: 4px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.builder-toolbar h2 {
  margin: 0;
}
.builder-layout {
  display: block;
  min-width: 0;
}
.builder-board {
  width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  padding-bottom: 8px;
}
.builder-board:focus-visible {
  outline: 2px solid var(--lime);
  outline-offset: 2px;
}
.builder-days {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(190px, 1fr);
  gap: 12px;
  align-items: start;
  margin: 16px 0;
}
.builder-day {
  min-width: 0;
  padding: 12px;
  border: 1px solid #8b949755;
  border-radius: 12px;
  background: #8b949709;
}
.builder-day-name input {
  font-weight: 700;
}
.builder-day-meta,
.builder-day-notes,
.builder-variant {
  font-size: 12px;
  margin: 4px 0 10px;
}
.builder-exercise {
  border-top: 1px solid #8b949744;
  padding: 14px 0;
}
.builder-exercise h3 {
  margin: 0 0 5px;
  font-size: 15px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.builder-technique {
  display: inline-block;
  font-size: 11px;
  padding: 3px 7px;
  border-radius: 5px;
  background: #8b949722;
}
.builder-prescription {
  font-size: 14px;
  margin: 8px 0;
}
.builder-exercise-details {
  margin-top: 10px;
  font-size: 12px;
}
.builder-exercise-details summary,
.builder-set {
  border-bottom: 1px solid #8b949755;
  padding: 10px 0;
}
.builder-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin: 0;
}
.builder-check input {
  width: auto;
}
.builder-recap {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}
.builder-recap :deep(.muscle-grid) {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px 24px;
}
.builder-recap :deep(.muscle-grid > div) {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.builder-recap :deep(.muscle-grid dd) {
  font-size: 14px;
}
.builder-recap :deep(.volume-summary) {
  margin-top: 8px;
}
@media (max-width: 760px) {
  .builder-days {
    grid-auto-columns: minmax(240px, 80vw);
  }
  .builder-recap :deep(.muscle-grid) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .builder-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
.program-builder label {
  margin-top: 5px;
  margin-bottom: 5px;
}
.program-builder label input,
.program-builder label select {
  margin-top: 4px;
}
.builder-toolbar .draft-status {
  margin: 4px 0;
}
.builder-exercise {
  padding: 9px 0;
}
.builder-exercise-details {
  margin-top: 6px;
}
.builder-day-name {
  margin-top: 0 !important;
}
.builder-recap h3 {
  margin: 0;
}
.builder-exercise-details :deep(.form-grid) {
  grid-template-columns: 1fr;
}
</style>
