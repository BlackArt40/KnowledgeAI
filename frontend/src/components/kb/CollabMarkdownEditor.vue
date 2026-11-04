<script setup lang="ts">
// Phase 2c: CodeMirror 6 bound to a shared Y.Text (y-codemirror.next).
// The parent owns the Yjs session; this component only renders/edits it.
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { yCollab } from "y-codemirror.next";
import type * as Y from "yjs";

const props = defineProps<{ text: Y.Text; readOnly?: boolean }>();

const host = ref<HTMLDivElement | null>(null);
const editable = new Compartment();
let view: EditorView | null = null;

function buildEditor() {
  if (!host.value) return;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: "",
      extensions: [
        keymap.of(defaultKeymap),
        markdown(),
        EditorView.lineWrapping,
        editable.of(EditorView.editable.of(!props.readOnly)),
        EditorView.theme({
          "&": { height: "420px", fontSize: "13px" },
          ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono, monospace)" },
        }),
        yCollab(props.text, null),
      ],
    }),
  });
}

watch(
  () => props.readOnly,
  (readOnly) => {
    view?.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!readOnly)) });
  }
);

onMounted(buildEditor);
onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});
</script>

<template>
  <div
    ref="host"
    class="cm-host"
  />
</template>

<style scoped>
.cm-host {
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-md);
  overflow: hidden;
}
.cm-host :deep(.cm-editor) {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.cm-host :deep(.cm-editor.cm-focused) {
  outline: none;
}
</style>
