<script setup lang="ts">
import {
  workoutSchema,
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
  selectedDays = ref<string[]>([]),
  selectedExercise = ref(''),
  saving = ref(false),
  error = ref('');
const pickerDayId = ref(''),
  pickerSearch = ref('');
const pickerDay = computed(() => days.value.find((day) => day.id === pickerDayId.value));
const pickerExercises = computed(() => {
  const query = pickerSearch.value.trim().toLocaleLowerCase('it-IT');
  return props.catalog.filter((row) =>
    (row.payload as Exercise).name.toLocaleLowerCase('it-IT').includes(query),
  );
});
function openExercisePicker(day: Day) {
  pickerSearch.value = '';
  pickerDayId.value = day.id;
}
function addToPickerDay(row: LocalRecord) {
  const day = pickerDay.value;
  if (!day || day.payload.exercises.length >= 50) return;
  day.payload.exercises.push(makePrescription(row));
  pickerDayId.value = '';
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
    selectedDays.value = [];
    selectedExercise.value = '';
    days.value = props.workouts.map((r) => ({
      id: r.id,
      revision: r.localRevision,
      payload: workoutSchema.parse(JSON.parse(JSON.stringify(r.payload))),
    }));
    try {
      const saved = JSON.parse(localStorage.getItem(key.value) || 'null');
      if (Array.isArray(saved)) days.value = saved;
    } catch {
      error.value = 'Bozza non leggibile. Sono disponibili le giornate salvate.';
    }
  },
);
watch(
  days,
  () => {
    if (!props.open) return;
    try {
      localStorage.setItem(key.value, JSON.stringify(days.value));
    } catch {
      error.value = 'Spazio locale non disponibile: salva prima di chiudere.';
    }
  },
  { deep: true },
);
function resetDraft() {
  days.value = props.workouts.map((r) => ({
    id: r.id,
    revision: r.localRevision,
    payload: workoutSchema.parse(JSON.parse(JSON.stringify(r.payload))),
  }));
  selectedDays.value = [];
  error.value = '';
}
function addDay(name: string) {
  const day = {
    id: crypto.randomUUID(),
    payload: { name, notes: '', order: days.value.length, exercises: [] },
  };
  days.value.push(day);
  selectedDays.value.push(day.id);
}
function addExercise() {
  const row = props.catalog.find((r) => r.id === selectedExercise.value);
  if (!row) return;
  for (const day of days.value.filter((d) => selectedDays.value.includes(d.id))) {
    if (day.payload.exercises.length < 50) day.payload.exercises.push(makePrescription(row));
  }
}
function variants(e: Prescription) {
  return (props.catalog.find((r) => r.id === e.exerciseId)?.payload as Exercise | undefined)?.variants || [];
}
function chooseVariant(e: Prescription, event: Event) {
  const variant = variants(e).find((v) => v.id === (event.target as HTMLSelectElement).value);
  e.variant = variant ? JSON.parse(JSON.stringify(variant)) : null;
}
function moveExercise(day: Day, index: number, event: Event) {
  const select = event.target as HTMLSelectElement;
  const target = days.value.find((d) => d.id === select.value);
  if (target && target.payload.exercises.length < 50)
    target.payload.exercises.push({ ...day.payload.exercises.splice(index, 1)[0]!, group: undefined });
  select.value = '';
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
async function save() {
  saving.value = true;
  error.value = '';
  try {
    await savePlanWorkouts(props.owner, props.plan.id, days.value);
    localStorage.removeItem(key.value);
    emit('saved');
    emit('close');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Salvataggio non riuscito';
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <AppModal :open="open" title="BUILDER DELLA SCHEDA" wide @close="!saving && emit('close')">
    <form v-if="open" class="program-builder" @submit.prevent="save">
      <header class="builder-toolbar">
        <div>
          <h2>{{ (plan.payload as any).name }}</h2>
          <p class="draft-status">
            {{ (plan.payload as any).start || 'Periodo da impostare'
            }}<template v-if="(plan.payload as any).end"> → {{ (plan.payload as any).end }}</template> · Bozza
            salvata sul dispositivo
          </p>
        </div>
        <button type="submit" class="primary" :disabled="saving || !days.length">
          {{ saving ? 'Salvataggio…' : 'Salva tutte le giornate' }}
        </button>
      </header>
      <details class="builder-add-days" :open="!days.length">
        <summary>Aggiungi giornate</summary>
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
          <button type="button" class="text-btn" @click="addDay('Giornata ' + (days.length + 1))">
            + Giornata personalizzata
          </button>
        </div>
      </details>
      <div class="builder-add">
        <label
          >Esercizio<select v-model="selectedExercise">
            <option value="">Scegli dal catalogo</option>
            <option v-for="e in catalog" :key="e.id" :value="e.id">{{ (e.payload as Exercise).name }}</option>
          </select></label
        >
        <fieldset>
          <legend>Aggiungi nelle giornate</legend>
          <div class="builder-destinations">
            <label v-for="day in days" :key="day.id" class="builder-check"
              ><input v-model="selectedDays" type="checkbox" :value="day.id" />{{ day.payload.name }}</label
            >
          </div>
        </fieldset>
        <button
          type="button"
          class="secondary"
          :disabled="!selectedExercise || !selectedDays.length"
          @click="addExercise"
        >
          Aggiungi alle giornate selezionate
        </button>
      </div>
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
                  :disabled="saving || day.payload.exercises.length >= 50"
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
                <label class="builder-count"
                  >Numero di serie<input
                    type="number"
                    :value="e.sets.length"
                    min="1"
                    max="30"
                    required
                    @change="setCount(e, $event)"
                /></label>
                <details class="builder-exercise-details">
                  <summary>Modifica esercizio e serie</summary>
                  <ExerciseGroup :exercise="e" :exercises="day.payload.exercises" />
                  <label
                    >Variante<select :value="e.variant?.id || ''" @change="chooseVariant(e, $event)">
                      <option value="">Standard</option>
                      <option
                        v-if="e.variant && !variants(e).some((v) => v.id === e.variant?.id)"
                        :value="e.variant.id"
                      >
                        {{ e.variant.name }} (salvata)
                      </option>
                      <option v-for="v in variants(e)" :key="v.id" :value="v.id">{{ v.name }}</option>
                    </select></label
                  >
                  <label
                    >Sposta in<select value="" @change="moveExercise(day, i, $event)">
                      <option value="">Scegli giornata</option>
                      <option
                        v-for="other in days.filter((d) => d.id !== day.id)"
                        :key="other.id"
                        :value="other.id"
                      >
                        {{ other.payload.name }}
                      </option>
                    </select></label
                  >
                  <div class="button-group">
                    <button
                      type="button"
                      class="text-btn"
                      :disabled="i === 0"
                      @click="
                        [day.payload.exercises[i - 1], day.payload.exercises[i]] = [
                          day.payload.exercises[i]!,
                          day.payload.exercises[i - 1]!,
                        ]
                      "
                    >
                      Sposta sopra</button
                    ><button
                      type="button"
                      class="text-btn"
                      :disabled="i === day.payload.exercises.length - 1"
                      @click="
                        [day.payload.exercises[i + 1], day.payload.exercises[i]] = [
                          day.payload.exercises[i]!,
                          day.payload.exercises[i + 1]!,
                        ]
                      "
                    >
                      Sposta sotto
                    </button>
                  </div>
                  <div v-for="(set, index) in e.sets" :key="index" class="builder-set">
                    <label class="builder-check"
                      ><input
                        type="checkbox"
                        :checked="set.countVolume !== false"
                        @change="set.countVolume = ($event.target as HTMLInputElement).checked"
                      />Serie {{ index + 1 }} · volume</label
                    >
                    <label v-if="!set.segments?.length"
                      >{{ e.measurement === 'duration' ? 'Secondi' : 'Ripetizioni'
                      }}<StableNumberInput
                        :value="e.measurement === 'duration' ? set.tut : set.reps"
                        :min="1"
                        :max="2000"
                        :step="1"
                        @commit="e.measurement === 'duration' ? (set.tut = $event) : (set.reps = $event)"
                    /></label>
                    <label v-if="!set.segments?.length"
                      >Kg<StableNumberInput
                        :value="set.load"
                        :min="0"
                        :max="2000"
                        :step="0.5"
                        @commit="set.load = $event"
                    /></label>
                    <SetTechnique :set="set" :measurement="e.measurement" />
                  </div>
                  <button type="button" class="text-btn danger" @click="day.payload.exercises.splice(i, 1)">
                    Rimuovi esercizio
                  </button>
                </details>
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
      <button type="button" class="text-btn" @click="resetDraft">Riparti dalle giornate salvate</button>
    </form>
  </AppModal>
  <AppModal :open="open && !!pickerDay" title="AGGIUNGI ESERCIZIO" @close="pickerDayId = ''">
    <div v-if="pickerDay" class="builder-picker">
      <h2>{{ pickerDay.payload.name }}</h2>
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
    </div>
  </AppModal>
</template>
<style scoped>
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
.builder-add-days {
  margin: 12px 0;
}
.builder-add {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
  padding: 12px 0;
}
.builder-add > label {
  min-width: 190px;
  flex: 1;
}
.builder-add fieldset {
  flex: 3;
  min-width: 0;
  margin: 0;
}
.builder-destinations {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
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
.builder-count {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}
.builder-count input {
  width: 64px;
  padding: 6px;
}
.builder-exercise-details {
  margin-top: 10px;
  font-size: 12px;
}
.builder-exercise-details summary,
.builder-add-days summary,
.builder-day-notes summary {
  cursor: pointer;
}
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
  .builder-add {
    display: block;
  }
  .builder-add > * {
    margin-bottom: 10px;
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
.builder-count {
  margin: 4px 0;
}
.builder-count input {
  margin-top: 0 !important;
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
.builder-add {
  padding: 4px 0;
}
.builder-recap h3 {
  margin: 0;
}
.builder-exercise-details :deep(.form-grid) {
  grid-template-columns: 1fr;
}
</style>
