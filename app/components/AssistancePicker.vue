<script setup lang="ts">
import { gornationBands, bandReference } from '../../shared/bands'
const props = defineProps<{
  modelValue: { id: string; name: string; minKg: number; maxKg: number }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: typeof props.modelValue] }>()
function toggle(id: string, checked: boolean) {
  const band = gornationBands.find((b) => b.id === id)!
  emit(
    'update:modelValue',
    checked ? [...props.modelValue, { ...band }] : props.modelValue.filter((b) => b.id !== id),
  )
}
</script>
<template>
  <fieldset class="assistance-picker">
    <legend>Assistenza con elastici</legend>
    <label v-for="band in gornationBands" :key="band.id" class="band-option">
      <input
        type="checkbox"
        :checked="modelValue.some((b) => b.id === band.id)"
        @change="toggle(band.id, ($event.target as HTMLInputElement).checked)"
      />
      <span
        >{{ band.name }} <small>{{ band.minKg }}–{{ band.maxKg }} kg</small></span
      >
    </label>
    <p class="notice">
      Range nominali: l’assistenza effettiva varia con allungamento e configurazione. Nessuna
      sottrazione fissa dal peso corporeo.
      <a :href="bandReference" target="_blank" rel="noopener noreferrer"
        >Riferimento GORNATION ↗</a
      >
    </p>
  </fieldset>
</template>
