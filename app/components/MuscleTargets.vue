<script setup lang="ts">
import { muscleGroups, type MuscleTargets, type Muscle } from '../../shared/domain';
const props = defineProps<{ modelValue?: MuscleTargets; inherited?: MuscleTargets }>();
const emit = defineEmits<{ 'update:modelValue': [value: MuscleTargets] }>();
const muscles = Object.keys(muscleGroups) as Muscle[];
const effective = (m: Muscle) => props.modelValue?.[m] ?? props.inherited?.[m] ?? 0;
const activeMuscles = computed(() => muscles.filter((m) => effective(m) > 0));
const availableMuscles = computed(() => muscles.filter((m) => effective(m) === 0));
function addMuscle(event: Event) {
  const select = event.target as HTMLSelectElement;
  const m = select.value as Muscle;
  if (muscles.includes(m)) emit('update:modelValue', { ...props.modelValue, [m]: 1 });
  select.value = '';
}
function change(m: Muscle, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  const next = { ...props.modelValue };
  if (value === '') delete next[m];
  else next[m] = Number(value);
  emit('update:modelValue', next);
}
</script>
<template>
  <details class="muscle-targets">
    <summary>
      {{ inherited ? 'Target variante (eredita se vuoto)' : 'La tua filosofia: target muscolari' }}
    </summary>
    <p class="notice">Ogni serie conta da 0 a 1 per ciascun muscolo. I coefficienti sono personali.</p>
    <label v-if="availableMuscles.length"
      >Aggiungi gruppo muscolare
      <select value="" @change="addMuscle">
        <option value="">Scegli un muscolo</option>
        <option v-for="m in availableMuscles" :key="m" :value="m">{{ muscleGroups[m] }}</option>
      </select>
    </label>
    <p v-if="!activeMuscles.length" class="notice">Nessun target attivo. Aggiungi i muscoli allenati.</p>
    <div class="muscle-grid">
      <label v-for="m in activeMuscles" :key="m"
        >{{ muscleGroups[m] }}
        <select :value="modelValue?.[m] ?? ''" @change="change(m, $event)">
          <option value="">
            {{ inherited ? 'Eredita: ' + (inherited[m] ?? 0).toLocaleString('it-IT') : 'Non impostato (0)' }}
          </option>
          <option v-for="n in 11" :key="n" :value="(n - 1) / 10">
            {{ ((n - 1) / 10).toLocaleString('it-IT') }}
          </option>
        </select>
      </label>
    </div>
  </details>
</template>
