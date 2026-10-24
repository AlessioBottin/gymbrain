<script setup lang="ts">
import {
  newTarget,
  exerciseSchema,
  workoutSchema,
  variantSchema,
  type MuscleTargets,
  type LocalRecord,
  type Prescription,
  type Exercise,
  type Kind,
} from '../../shared/domain';
const props = defineProps<{
  owner: string;
  saving?: boolean;
  open: boolean;
  kind: Kind;
  record?: LocalRecord;
  parentId?: string;
  catalog: LocalRecord[];
}>();
const emit = defineEmits<{
  close: [];
  save: [kind: Kind, payload: any, id?: string, parentId?: string | null, revision?: number];
}>();
const draft = ref<any>({}),
  error = ref(''),
  selectedExercise = ref('');
const selectedMeasurement = computed({
  get: () => draft.value.measurement || 'reps',
  set: (value: string) => {
    draft.value.measurement = value;
  },
});
const descriptionOpen = ref(false),
  videoLinkOpen = ref(false);
const selectedVariantId = ref('');
const selectedVariant = computed(
  () => draft.value.variants?.find((v: any) => v.id === selectedVariantId.value) || draft.value.variants?.[0],
);
const variantDraft = ref<Exercise['variants'][number]>();
const variantError = ref('');
const targetsOpen = ref(false);
const targetDraft = ref<MuscleTargets>({});
function editVariant() {
  if (!selectedVariant.value) return;
  variantDraft.value = JSON.parse(JSON.stringify(selectedVariant.value));
  variantError.value = '';
}
function confirmVariant() {
  const result = variantSchema.safeParse(variantDraft.value);
  if (!result.success) {
    variantError.value = 'Controlla il nome e i dati della variante.';
    return;
  }
  const index = draft.value.variants.findIndex((v: any) => v.id === result.data.id);
  if (index < 0) draft.value.variants.push(result.data);
  else draft.value.variants[index] = result.data;
  selectedVariantId.value = result.data.id;
  variantDraft.value = undefined;
}
function openTargets() {
  targetDraft.value = { ...variantDraft.value?.muscleTargets };
  targetsOpen.value = true;
}
function confirmTargets() {
  if (variantDraft.value) variantDraft.value.muscleTargets = { ...targetDraft.value };
  targetsOpen.value = false;
}
const prescriptions = computed(() => draft.value.exercises as Prescription[]);
const draftKey = computed(
  () => `gymbrain-draft:${props.owner}:${props.kind}:${props.record?.id || props.parentId || 'new'}`,
);
const draftNotice = ref('');
const baseRevision = ref<number>();
let initialDraft: any = {};
watch(
  draft,
  () => {
    if (!props.open || !props.owner) return;
    try {
      localStorage.setItem(
        draftKey.value,
        JSON.stringify({ payload: draft.value, revision: baseRevision.value }),
      );
      draftNotice.value = 'Modifiche non ancora confermate.';
    } catch {
      draftNotice.value = 'Spazio locale non disponibile: salva prima di chiudere.';
    }
  },
  { deep: true },
);
const fields = ['reps', 'load', 'rpe', 'rir', 'tut'] as const;
const modes = [
  ['bodyweight', 'Corpo libero'],
  ['weighted', 'Zavorra'],
  ['external', 'Carico esterno'],
  ['band', 'Banda elastica'],
];
watch(
  () => props.open,
  (value) => {
    variantDraft.value = undefined;
    targetsOpen.value = false;
    if (!value) return;
    descriptionOpen.value = false;
    videoLinkOpen.value = false;
    error.value = '';
    selectedExercise.value = '';
    selectedVariantId.value = '';
    draft.value = props.record
      ? JSON.parse(
          JSON.stringify(
            props.kind === 'exercise'
              ? exerciseSchema.parse(props.record.payload)
              : props.kind === 'workout'
                ? workoutSchema.parse(props.record.payload)
                : props.record.payload,
          ),
        )
      : props.kind === 'exercise'
        ? {
            name: '',
            description: '',
            notes: '',
            exerciseType: 'bodyweight',
            measurement: 'reps',
            variants: [],
            videoUrl: '',
            videoPath: '',
          }
        : props.kind === 'cycle'
          ? { name: '', notes: '', start: new Date().toISOString().slice(0, 10), weeks: 6 }
          : props.kind === 'plan'
            ? {
                name: '',
                notes: '',
                order: 0,
                start: new Date().toISOString().slice(0, 10),
                end: new Date().toISOString().slice(0, 10),
              }
            : props.kind === 'weight'
              ? { kg: 75, measuredAt: new Date().toISOString(), source: 'manual' }
              : { name: '', notes: '', order: 0, exercises: [] };
    initialDraft = JSON.parse(JSON.stringify(draft.value));
    baseRevision.value = props.record?.localRevision;
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey.value) || 'null');
      if (saved?.payload) {
        draft.value = saved.payload;
        baseRevision.value = saved.revision;
        draftNotice.value = 'Bozza recuperata: puoi continuare da dove eri rimasto.';
      }
    } catch {
      draftNotice.value = 'Bozza non leggibile: il record salvato è disponibile.';
    }
  },
);
function addExercise() {
  const row = props.catalog.find((r) => r.id === selectedExercise.value);
  if (!row) return;
  const e = row.payload as Exercise;
  draft.value.exercises.push({
    id: crypto.randomUUID(),
    exerciseId: row.id,
    muscleTargets: { ...e.muscleTargets },
    name: e.name,
    notes: '',
    mode: e.exerciseType === 'weights' ? 'external' : 'bodyweight',
    exerciseType: e.exerciseType,
    measurement: e.measurement || 'reps',
    variant: null,
    assistance: [],
    band: '',
    alternatives: [],
    sets: [newTarget(e.measurement), newTarget(e.measurement), newTarget(e.measurement)],
  } satisfies Prescription);
  selectedExercise.value = '';
}
function addVariant() {
  variantDraft.value = { id: crypto.randomUUID(), name: '', notes: '' };
  variantError.value = '';
}
function variantsFor(id: string) {
  return (props.catalog.find((r) => r.id === id)?.payload as Exercise | undefined)?.variants || [];
}
function chooseVariant(e: Prescription, id: string) {
  const variant = variantsFor(e.exerciseId).find((v) => v.id === id);
  e.variant = variant ? { ...variant } : null;
}
function setLoad(e: Prescription, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  for (const set of e.sets) set.load = value === '' ? null : Number(value);
}
function move(index: number, dir: number) {
  const list = draft.value.exercises,
    other = index + dir;
  if (other < 0 || other >= list.length) return;
  [list[index], list[other]] = [list[other], list[index]];
}
function submit() {
  if (props.kind === 'exercise') {
    const incomplete = draft.value.variants.find((v: any) => !v.name.trim());
    if (incomplete) {
      selectedVariantId.value = incomplete.id;
      editVariant();
      error.value = 'Inserisci il nome della variante selezionata.';
      return;
    }
    delete draft.value.mode;
  }
  emit(
    'save',
    props.kind,
    JSON.parse(JSON.stringify(draft.value)),
    props.record?.id,
    props.record?.parent_id ?? props.parentId ?? null,
    baseRevision.value,
  );
}
function clean(set: any, key: string, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  set[key] = value === '' ? null : Number(value);
}
</script>
<template>
  <AppModal
    :open="open"
    :title="record ? 'PERSONALIZZA IL TUO PERCORSO' : 'UN NUOVO INIZIO'"
    :wide="kind === 'workout'"
    @close="!saving && emit('close')"
    ><form v-if="open" @submit.prevent="submit" :aria-busy="saving" :inert="saving || undefined">
      <p class="draft-status" role="status">{{ draftNotice }}</p>
      <button
        type="button"
        class="text-btn"
        @click="
          draft = JSON.parse(JSON.stringify(initialDraft));
          baseRevision = record?.localRevision;
        "
      >
        Riparti dai dati salvati
      </button>
      <h2>
        {{
          (
            {
              exercise: 'Il tuo movimento.',
              cycle: 'La tua direzione.',
              plan: 'La tua scheda.',
              workout: 'La tua giornata.',
              weight: 'Ascolta il tuo corpo.',
            } as any
          )[kind]
        }}
      </h2>
      <template v-if="kind === 'weight'"
        ><label
          >Peso corporeo (kg)<input
            v-model.number="draft.kg"
            type="number"
            min="1"
            max="500"
            step=".1"
            required
        /></label>
        <p class="notice">
          Registrazione manuale di adesso. Le sessioni precedenti mantengono il loro peso.
        </p></template
      ><template v-else
        ><label>Nome<input v-model="draft.name" required maxlength="100" autofocus /></label
        ><template v-if="kind === 'exercise'"
          ><button
            v-if="!descriptionOpen && !draft.description"
            type="button"
            class="text-btn optional-field-add"
            @click="descriptionOpen = true"
          >
            + Aggiungi descrizione
          </button>
          <label v-else>Descrizione<textarea v-model="draft.description" rows="2" maxlength="4000" /></label>
          <fieldset class="exercise-choices">
            <legend>Tipologia esercizio</legend>
            <div class="exercise-choice-options">
              <label
                ><input
                  v-model="draft.exerciseType"
                  type="radio"
                  name="exercise-type"
                  value="bodyweight"
                /><span>Corpo libero</span></label
              >
              <label
                ><input v-model="draft.exerciseType" type="radio" name="exercise-type" value="weights" /><span
                  >Pesi</span
                ></label
              >
            </div>
          </fieldset>
          <fieldset class="exercise-choices">
            <legend>Modalità di esecuzione</legend>
            <div class="exercise-choice-options">
              <label
                ><input
                  v-model="selectedMeasurement"
                  type="radio"
                  name="exercise-measurement"
                  value="reps"
                /><span>Ripetizioni</span></label
              >
              <label
                ><input
                  v-model="selectedMeasurement"
                  type="radio"
                  name="exercise-measurement"
                  value="duration"
                /><span>Isometria</span></label
              >
            </div>
          </fieldset>
          <section aria-label="Muscoli target dell'esercizio">
            <h3>Muscoli target</h3>
            <MuscleTargets v-model="draft.muscleTargets" expanded />
          </section>
          <fieldset class="assistance-picker">
            <legend>Varianti del movimento</legend>
            <p class="notice">Per esempio HSPU con variante Deep. Il sovraccarico si imposta nella scheda.</p>
            <p v-if="draft.variants.length" class="variant-summary" role="status">
              {{ draft.variants.length }} varianti: {{ draft.variants.map((v: any) => v.name).join(' / ') }}
            </p>
            <div v-if="draft.variants.length" class="variant-selection">
              <label
                >Variante da modificare
                <select
                  :value="selectedVariant?.id || ''"
                  @change="selectedVariantId = ($event.target as HTMLSelectElement).value"
                >
                  <option v-for="(variant, i) in draft.variants" :key="variant.id" :value="variant.id">
                    {{ variant.name || 'Nuova variante ' + (Number(i) + 1) }}
                  </option>
                </select>
              </label>
              <button
                type="button"
                class="icon-btn"
                aria-label="Modifica variante"
                title="Modifica variante"
                @click="editVariant"
              >
                <GIcon name="edit" :size="18" />
              </button>
              <button
                type="button"
                class="icon-btn danger"
                aria-label="Rimuovi variante"
                title="Rimuovi variante"
                @click="draft.variants = draft.variants.filter((v: any) => v.id !== selectedVariant?.id)"
              >
                <GIcon name="trash" :size="18" />
              </button>
            </div>
            <button
              type="button"
              class="secondary"
              :disabled="draft.variants.length >= 30"
              @click="addVariant"
            >
              Aggiungi variante +
            </button>
          </fieldset>
          <button
            v-if="!videoLinkOpen && !draft.videoUrl"
            type="button"
            class="text-btn optional-field-add"
            @click="videoLinkOpen = true"
          >
            + Aggiungi link video
          </button>
          <label v-else
            >Video dimostrativo · link HTTPS<input
              v-model="draft.videoUrl"
              type="url"
              pattern="https://.*"
              placeholder="https://…" /></label
        ></template>
        <div v-if="kind === 'plan'" class="form-grid">
          <label>Inizio periodo<input v-model="draft.start" type="date" required /></label>
          <label>Fine periodo<input v-model="draft.end" type="date" :min="draft.start" required /></label>
        </div>
        <div v-if="kind === 'cycle'" class="form-grid">
          <label>Data di inizio<input v-model="draft.start" type="date" required /></label
          ><label
            >Durata (settimane)<input v-model.number="draft.weeks" type="number" min="1" max="52" required
          /></label>
        </div>
        <label v-if="kind === 'workout'"
          >Posizione nell’ordine<input
            v-model.number="draft.order"
            type="number"
            min="0"
            max="1000"
            required /></label
        ><label
          >{{
            kind === 'exercise'
              ? 'Note generali'
              : 'Note della ' + (kind === 'plan' ? 'scheda' : 'programmazione')
          }}<textarea v-model="draft.notes" rows="2" maxlength="4000" /></label
      ></template>
      <template v-if="kind === 'workout'"
        ><VolumeSummary :exercises="prescriptions" :catalog="catalog" />
        <div class="add-exercise">
          <label
            >Aggiungi dal tuo catalogo<select v-model="selectedExercise">
              <option value="">Scegli esercizio</option>
              <option v-for="e in catalog" :key="e.id" :value="e.id">
                {{ (e.payload as Exercise).name }}
              </option>
            </select></label
          ><button type="button" class="secondary" :disabled="!selectedExercise" @click="addExercise">
            Aggiungi +
          </button>
        </div>
        <p v-if="!catalog.length" class="notice">Crea prima i tuoi esercizi nella sezione Esercizi.</p>
        <TransitionGroup name="list" tag="div"
          ><section v-for="(e, i) in prescriptions" :key="e.id" class="prescription-editor">
            <div class="inline-top">
              <h3>{{ i + 1 }}. {{ e.name }}</h3>
              <div class="button-group">
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="Sposta sopra"
                  :disabled="i === 0"
                  @click="move(i, -1)"
                >
                  ↑</button
                ><button
                  type="button"
                  class="icon-btn"
                  aria-label="Sposta sotto"
                  :disabled="i === prescriptions.length - 1"
                  @click="move(i, 1)"
                >
                  ↓</button
                ><button
                  type="button"
                  class="icon-btn danger"
                  aria-label="Rimuovi esercizio dalla giornata"
                  @click="prescriptions.splice(i, 1)"
                  title="Rimuovi esercizio dalla giornata"
                >
                  <GIcon name="trash" :size="18" />
                </button>
              </div>
            </div>
            <label
              >Modalità di esecuzione<select
                :value="e.measurement || 'reps'"
                @change="e.measurement = ($event.target as HTMLSelectElement).value as 'reps' | 'duration'"
              >
                <option value="reps">A ripetizioni</option>
                <option value="duration">Isometria - secondi</option>
              </select></label
            >
            <label
              >Note specifiche per questa scheda<textarea
                v-model="e.notes"
                rows="2"
                placeholder="Es. salita esplosiva nella fase di forza"
              />
            </label>
            <label
              >Variante del movimento<select
                :value="e.variant?.id || ''"
                @change="chooseVariant(e, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">Standard</option>
                <option
                  v-if="e.variant && !variantsFor(e.exerciseId).some((v) => v.id === e.variant?.id)"
                  :value="e.variant.id"
                >
                  {{ e.variant.name }} (salvata nella scheda)
                </option>
                <option v-for="v in variantsFor(e.exerciseId)" :key="v.id" :value="v.id">
                  {{ v.name }}
                </option>
              </select></label
            >
            <ExerciseGroup :exercise="e" :exercises="prescriptions" />
            <p v-if="e.variant?.notes" class="notice">{{ e.variant.notes }}</p>
            <p class="subtle">
              {{
                e.exerciseType === 'bodyweight'
                  ? 'Corpo libero · sovraccarico per serie in kg'
                  : 'Pesi · carico per serie in kg'
              }}
            </p>
            <label
              >{{ e.exerciseType === 'bodyweight' ? 'Sovraccarico (kg)' : 'Carico (kg)'
              }}<input
                type="number"
                min="0"
                max="2000"
                step="0.5"
                :value="e.sets[0]?.load ?? ''"
                placeholder="Nessuno"
                @input="setLoad(e, $event)"
            /></label>
            <p class="notice">
              Imposta tutte le serie; puoi poi modificare i kg di ciascuna serie qui sotto.
            </p>
            <AssistancePicker v-if="e.exerciseType === 'bodyweight'" v-model="e.assistance" />
            <label v-if="e.exerciseType === 'bodyweight'"
              >Banda / configurazione<input
                v-model="e.band"
                maxlength="200"
                placeholder="Punto di ancoraggio, piede o ginocchio, eventuale altra banda"
            /></label>
            <label
              >Alternative consigliate<select v-model="e.alternatives" multiple class="alternatives">
                <option v-for="a in catalog.filter((a) => a.id !== e.exerciseId)" :key="a.id" :value="a.id">
                  {{ (a.payload as Exercise).name }}
                </option>
              </select></label
            >
            <p class="notice">Target per serie · lascia vuoto se non prescritto</p>
            <div class="target-editor heading" :class="{ isometric: e.measurement === 'duration' }">
              <span>#</span><span>{{ e.measurement === 'duration' ? 'Secondi' : 'Rep' }}</span
              ><span>{{ e.exerciseType === 'bodyweight' ? '+ Kg' : 'Kg' }}</span
              ><span>RPE</span><span>RIR</span><span v-if="e.measurement !== 'duration'">TUT s</span><span />
            </div>
            <div
              v-for="(s, j) in e.sets"
              :key="j"
              class="target-editor"
              :class="{ isometric: e.measurement === 'duration' }"
            >
              <span
                ><input
                  type="checkbox"
                  :checked="s.countVolume !== false"
                  :aria-label="`Serie ${j + 1} inclusa nel volume`"
                  @change="s.countVolume = ($event.target as HTMLInputElement).checked"
                />{{ j + 1 }}</span
              ><StableNumberInput
                v-for="k in e.measurement === 'duration' ? (['tut', 'load', 'rpe', 'rir'] as const) : fields"
                :key="k"
                :aria-label="`${e.name} serie ${j + 1} target ${k}`"
                :value="s[k]"
                type="number"
                :min="k === 'rpe' ? 1 : 0"
                :max="['rpe', 'rir'].includes(k) ? 10 : 2000"
                :step="['rpe', 'load'].includes(k) ? '.5' : 1"
                @commit="s[k] = $event"
              /><button
                type="button"
                class="icon-btn danger"
                aria-label="Rimuovi serie"
                :disabled="e.sets.length === 1"
                @click="e.sets.splice(j, 1)"
                title="Rimuovi serie"
              >
                <GIcon name="trash" :size="18" />
              </button>
            </div>
            <details>
              <summary>Tecniche e recuperi per serie</summary>
              <div v-for="(set, index) in e.sets" :key="index">
                <h4>Serie {{ index + 1 }}</h4>
                <SetTechnique :set="set" :measurement="e.measurement" />
              </div>
            </details>
            <button
              type="button"
              class="text-btn"
              :disabled="e.sets.length >= 30"
              @click="e.sets.push(newTarget(e.measurement))"
            >
              + Aggiungi serie
            </button>
          </section></TransitionGroup
        ></template
      >
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="submit" class="primary modal-save" :disabled="saving">
        {{ saving ? 'Salvataggio in corso...' : 'Salva' }} <GIcon name="check" />
      </button></form
  ></AppModal>
  <AppModal :open="open && !!variantDraft" title="VARIANTE DEL MOVIMENTO" @close="variantDraft = undefined">
    <form v-if="variantDraft" @submit.prevent="confirmVariant">
      <label
        >Nome variante<input
          v-model="variantDraft.name"
          required
          maxlength="100"
          placeholder="Deep / profondo"
      /></label>
      <label>Note variante<textarea v-model="variantDraft.notes" maxlength="4000" rows="2" /></label>
      <button type="button" class="secondary variant-target-button" @click="openTargets">
        <GIcon name="edit" :size="14" /> Target muscolari
      </button>
      <p v-if="variantError" role="alert">{{ variantError }}</p>
      <div class="button-group variant-dialog-actions">
        <button type="button" class="secondary" @click="variantDraft = undefined">Annulla</button>
        <button type="submit" class="primary">Conferma variante</button>
      </div>
    </form>
  </AppModal>
  <AppModal
    :open="open && !!variantDraft && targetsOpen"
    title="TARGET DELLA VARIANTE"
    @close="targetsOpen = false"
  >
    <template v-if="variantDraft">
      <h2>{{ variantDraft.name || 'Nuova variante' }}</h2>
      <MuscleTargets v-model="targetDraft" :inherited="draft.muscleTargets || {}" expanded />
      <div class="button-group variant-dialog-actions">
        <button type="button" class="secondary" @click="targetsOpen = false">Annulla</button>
        <button type="button" class="primary" @click="confirmTargets">Conferma target</button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
.variant-selection {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 12px;
}
.variant-selection label {
  flex: 1;
  min-width: 0;
  margin: 0;
}
.variant-selection select {
  margin-bottom: 0;
}
.variant-selection .icon-btn {
  width: 44px;
  height: 44px;
}
.variant-target-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  min-height: 32px;
  padding: 6px 10px;
}
.variant-dialog-actions {
  margin-top: 20px;
}
</style>
