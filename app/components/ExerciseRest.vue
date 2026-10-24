<script setup lang="ts">
import type { Prescription } from '../../shared/domain';
defineProps<{ exercise: Prescription }>();
</script>
<template>
  <label v-if="!exercise.group"
    >Recupero tra le serie (secondi)<input
      type="number"
      min="0"
      max="3600"
      required
      :value="exercise.restSeconds ?? exercise.sets[0]?.restSeconds ?? 90"
      @input="exercise.restSeconds = Number(($event.target as HTMLInputElement).value)"
  /></label>
</template>
