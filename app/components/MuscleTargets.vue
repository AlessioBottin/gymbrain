<script setup lang="ts">
import { muscleGroups, type MuscleTargets, type Muscle } from '../../shared/domain';
const props = defineProps<{ modelValue?: MuscleTargets; inherited?: MuscleTargets }>();
const emit = defineEmits<{ 'update:modelValue': [value: MuscleTargets] }>();
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
    <div class="muscle-grid">
      <label v-for="(label, m) in muscleGroups" :key="m"
        >{{ label }}
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
