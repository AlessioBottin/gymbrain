<script setup lang="ts">
import { muscleGroups, normalizeMuscleTargets, type MuscleTargets, type Muscle } from '../../shared/domain';
const props = defineProps<{ modelValue?: MuscleTargets; inherited?: MuscleTargets; expanded?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: MuscleTargets] }>();
const muscles = Object.keys(muscleGroups) as Muscle[];
const ownTargets = computed(() => normalizeMuscleTargets(props.modelValue) as MuscleTargets | undefined);
const inheritedTargets = computed(() => normalizeMuscleTargets(props.inherited) as MuscleTargets | undefined);
const effective = (m: Muscle) => ownTargets.value?.[m] ?? inheritedTargets.value?.[m] ?? 0;
const activeMuscles = computed(() => muscles.filter((m) => effective(m) > 0));
const menuOpen = ref(false);
const selectedMuscle = ref<Muscle | ''>('');
const coefficient = ref<number | ''>(1);
const editing = ref(false);
function openTarget(m?: Muscle) {
  editing.value = !!m;
  selectedMuscle.value = m || '';
  coefficient.value = m ? (ownTargets.value?.[m] ?? '') : 1;
  menuOpen.value = true;
}
function confirmTarget() {
  const m = selectedMuscle.value;
  if (!m || (!editing.value && effective(m) > 0)) return;
  const next = { ...ownTargets.value };
  if (coefficient.value === '') delete next[m];
  else next[m] = Number(coefficient.value);
  emit('update:modelValue', next);
  menuOpen.value = false;
}
function removeTarget(m: Muscle) {
  emit('update:modelValue', { ...ownTargets.value, [m]: 0 });
}
</script>
<template>
  <component :is="expanded ? 'div' : 'details'" class="muscle-targets">
    <summary v-if="!expanded">Target muscolari</summary>
    <ul v-if="activeMuscles.length" class="assigned-list">
      <li v-for="m in activeMuscles" :key="m" class="target-row">
        <span class="assigned-name">{{ muscleGroups[m] }}</span>
        <strong class="target-value">{{ effective(m).toLocaleString('it-IT') }}</strong>
        <button
          type="button"
          class="icon-btn"
          :aria-label="'Modifica target ' + muscleGroups[m]"
          @click="openTarget(m)"
        >
          <GIcon name="edit" :size="16" />
        </button>
        <button
          type="button"
          class="icon-btn danger"
          :aria-label="'Rimuovi target ' + muscleGroups[m]"
          @click="removeTarget(m)"
        >
          <GIcon name="trash" :size="16" />
        </button>
      </li>
    </ul>
    <button
      type="button"
      class="secondary compact-add"
      aria-label="Aggiungi target muscolare"
      :disabled="activeMuscles.length === muscles.length"
      @click="openTarget()"
    >
      Aggiungi
    </button>
  </component>
  <Teleport to="body">
    <AppModal :open="menuOpen" title="TARGET MUSCOLARE" @close="menuOpen = false">
      <form @submit.stop.prevent="confirmTarget">
        <label
          >Muscolo<select v-model="selectedMuscle" :disabled="editing" required autofocus>
            <option value="">Seleziona muscolo</option>
            <option v-for="m in muscles" :key="m" :value="m" :disabled="!editing && effective(m) > 0">
              {{ muscleGroups[m] }}{{ !editing && effective(m) > 0 ? ' (aggiunto)' : '' }}
            </option>
          </select></label
        >
        <label
          >Valore<select v-model="coefficient">
            <option v-if="inherited && selectedMuscle" value="">
              Eredita: {{ (inheritedTargets?.[selectedMuscle] ?? 0).toLocaleString('it-IT') }}
            </option>
            <option v-for="n in 11" :key="n" :value="(n - 1) / 10">
              {{ ((n - 1) / 10).toLocaleString('it-IT') }}
            </option>
          </select></label
        >
        <div class="button-group">
          <button type="button" class="secondary" @click="menuOpen = false">Annulla</button>
          <button type="submit" class="primary" :disabled="!selectedMuscle">
            {{ editing ? 'Conferma' : 'Aggiungi' }}
          </button>
        </div>
      </form>
    </AppModal>
  </Teleport>
</template>
