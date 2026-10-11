<script setup lang="ts">
const props = defineProps<{ open: boolean; title: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
watch(
  () => props.open,
  async (value) => {
    await nextTick()
    if (value && !dialog.value?.open) dialog.value?.showModal()
    else if (!value && dialog.value?.open) dialog.value?.close()
  },
  { immediate: true },
)
</script>
<template>
  <dialog
    ref="dialog"
    :aria-label="title"
    :class="{ session: wide }"
    @cancel.prevent="emit('close')"
    @click="
      (e) => {
        if (e.target === dialog) emit('close')
      }
    "
  >
    <div class="modal-top">
      <span class="eyebrow">{{ title }}</span
      ><button class="icon-btn" type="button" aria-label="Chiudi" @click="emit('close')">
        <GIcon name="close" :size="16" />
      </button>
    </div>
    <slot />
  </dialog>
</template>
