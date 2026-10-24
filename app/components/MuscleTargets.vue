<script setup lang="ts">
import { muscleGroups, normalizeMuscleTargets, type MuscleTargets, type Muscle } from '../../shared/domain';
const props = defineProps<{ modelValue?: MuscleTargets; inherited?: MuscleTargets; expanded?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: MuscleTargets] }>();
const muscles = Object.keys(muscleGroups) as Muscle[];
const ownTargets = computed(() => normalizeMuscleTargets(props.modelValue) as MuscleTargets | undefined);
const inheritedTargets = computed(() => normalizeMuscleTargets(props.inherited) as MuscleTargets | undefined);
const effective = (m: Muscle) => ownTargets.value?.[m] ?? inheritedTargets.value?.[m] ?? 0;
const activeMuscles = computed(() => muscles.filter((m) => effective(m) > 0));
const addedMuscle = ref<Muscle | ''>('');
watch(activeMuscles, (active) => {
  if (addedMuscle.value && !active.includes(addedMuscle.value)) addedMuscle.value = '';
});
function addMuscle(event: Event) {
  const select = event.target as HTMLSelectElement;
  const m = select.value as Muscle;
  if (muscles.includes(m) && effective(m) === 0) {
    addedMuscle.value = m;
    emit('update:modelValue', { ...ownTargets.value, [m]: 1 });
  }
}
function change(m: Muscle, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  const next = { ...ownTargets.value };
  if (value === '') delete next[m];
  else next[m] = Number(value);
  emit('update:modelValue', next);
}
</script>
<template>
  <component :is="expanded ? 'div' : 'details'" class="muscle-targets">
    <summary v-if="!expanded">
      {{ inherited ? 'Target variante' : 'Muscoli target' }}
    </summary>
    <label
      >Aggiungi muscolo
      <select :value="addedMuscle" @change="addMuscle">
        <option value="">Scegli un muscolo</option>
        <option v-for="m in muscles" :key="m" :value="m" :disabled="effective(m) > 0">
          {{ muscleGroups[m] }}{{ effective(m) > 0 ? ' (aggiunto)' : '' }}
        </option>
      </select>
    </label>
    <div class="muscle-grid">
      <label v-for="m in activeMuscles" :key="m"
        >{{ muscleGroups[m] }}
        <select :value="ownTargets?.[m] ?? ''" @change="change(m, $event)">
          <option value="">
            {{ inherited ? 'Eredita: ' + (inheritedTargets?.[m] ?? 0).toLocaleString('it-IT') : '0' }}
          </option>
          <option v-for="n in 11" :key="n" :value="(n - 1) / 10">
            {{ ((n - 1) / 10).toLocaleString('it-IT') }}
          </option>
        </select>
      </label>
    </div>
  </component>
</template>
