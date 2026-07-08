import type { AgentTask } from "./types";

type Store = { tasks: Map<string, AgentTask> };
const g = globalThis as unknown as { __KAI_AGENT_STORE__?: Store };
function store(): Store {
  if (!g.__KAI_AGENT_STORE__) g.__KAI_AGENT_STORE__ = { tasks: new Map() };
  return g.__KAI_AGENT_STORE__;
}

function uid() {
  return `task_${Math.random().toString(36).slice(2, 10)}`;
}

export function listTasks(): AgentTask[] {
  return Array.from(store().tasks.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );
}

export function getTask(id: string): AgentTask | undefined {
  return store().tasks.get(id);
}

export function createTask(input: {
  topic: string;
  kbId?: string;
  kbName?: string;
  outputFormat: AgentTask["outputFormat"];
  agents: AgentTask["agents"];
  maxSteps: number;
}): AgentTask {
  const now = Date.now();
  const task: AgentTask = {
    id: uid(),
    topic: input.topic,
    kbId: input.kbId,
    kbName: input.kbName,
    outputFormat: input.outputFormat,
    agents: input.agents,
    maxSteps: input.maxSteps,
    status: "queued",
    steps: [],
    citations: [],
    outline: [],
    createdAt: now,
    updatedAt: now,
  };
  store().tasks.set(task.id, task);
  return task;
}

export function saveTask(task: AgentTask) {
  task.updatedAt = Date.now();
  store().tasks.set(task.id, task);
}

export function deleteTask(id: string): boolean {
  return store().tasks.delete(id);
}
