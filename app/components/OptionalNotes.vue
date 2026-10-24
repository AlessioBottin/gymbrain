<script setup lang="ts">
defineProps<{ modelValue: string; label?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [] }>();
const open = ref(false);
</script>
<template>
  <button v-if="!open && !modelValue" type="button" class="text-btn optional-field-add" @click="open = true">
    + Aggiungi note
  </button>
  <label v-else
    >{{ label || 'Note'
    }}<textarea
      :value="modelValue"
      maxlength="4000"
      rows="2"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @change="emit('change')"
    />
  </label>
</template>
