<script setup lang="ts">
import { Loading } from "@element-plus/icons-vue";

defineProps<{
  items: { k: string; label: string; desc: string }[];
  prefs: Record<string, boolean> | null;
  saving: string | null;
}>();
const emit = defineEmits<{ toggle: [key: string, value: boolean] }>();
</script>

<template>
  <div class="card">
    <div class="card-head">
      <h2>{{ $t("page.settings.s90") }}</h2>
    </div>
    <div class="card-body">
      <div
        v-for="n in items"
        :key="n.k"
        class="pref-row"
      >
        <div>
          <p class="pref-label">
            {{ n.label }}
          </p>
          <p class="hint">
            {{ n.desc }}
          </p>
        </div>
        <div class="pref-right">
          <el-icon
            v-if="saving === n.k"
            class="spin"
            :size="13"
          >
            <Loading />
          </el-icon>
          <el-switch
            :model-value="prefs ? prefs[n.k] : false"
            :disabled="!prefs"
            :aria-label="n.label"
            @update:model-value="(v: string | number | boolean) => emit('toggle', n.k, !!v)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="../settings.css"></style>
