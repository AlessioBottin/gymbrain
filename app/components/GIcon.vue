<script setup lang="ts">
defineProps<{ name: string; size?: number }>();
const paths: Record<string, string> = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  layers: 'm12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5',
  barbell: 'M3 8v8M6 5v14M18 5v14M21 8v8M6 12h12',
  chart: 'M3 3v18h18M6 15l5-5 4 3 6-8',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  arrowUp: 'M12 20V4m-6 6 6-6 6 6',
  arrowDown: 'M12 4v16m-6-6 6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  edit: 'm16 3 5 5M3 21l5-1L21 7a2 2 0 0 0-5-5L3 15v6Z',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  chevron: 'm9 5 7 7-7 7',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  swap: 'M3 7h17l-4-4M21 17H4l4 4M20 7l-4 4M4 17l4-4',
  search: 'M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  play: 'm8 4 12 8-12 8V4Z',
  weight: 'M8 7V5a4 4 0 0 1 8 0v2M5 7h14l3 14H2L5 7Z',
  leaf: 'M20 3C5 2 0 12 7 18S22 15 20 3ZM5 21l10-13',
  calendar: 'M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2ZM7 2v6M17 2v6M3 11h18',
  logout: 'M9 3H3v18h6m7-14 5 5-5 5M8 12h13',
  undo: 'M4 4v6h6M4 10a8 8 0 1 1 0 7',
  bolt: 'm13 2-9 12h7l-1 8 10-13h-7l0-7',
  info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  menu: 'M4 6h16M4 12h16M4 18h16',
};
</script>
<template>
  <svg
    :width="size || 20"
    :height="size || 20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.grid" />
  </svg>
</template>
