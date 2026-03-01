/**
 * Local in-memory checkpoint store.
 * Replaces the @directive-run/ai checkpoint utilities
 * so this example has zero AI dependencies.
 */

export interface Checkpoint {
  version: number;
  id: string;
  createdAt: string;
  label: string;
  systemExport: string;
  timelineExport: string | null;
  localState: Record<string, unknown>;
  memoryExport: string | null;
  orchestratorType: string;
}

export class InMemoryCheckpointStore {
  private store = new Map<string, Checkpoint>();

  async save(checkpoint: Checkpoint): Promise<void> {
    this.store.set(checkpoint.id, checkpoint);
  }

  async load(id: string): Promise<Checkpoint | null> {
    return this.store.get(id) ?? null;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async list(): Promise<Checkpoint[]> {
    return [...this.store.values()];
  }
}

export function createCheckpointId(): string {
  return crypto.randomUUID?.() ?? `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function validateCheckpoint(cp: unknown): cp is Checkpoint {
  if (typeof cp !== "object" || cp === null) {
    return false;
  }

  const obj = cp as Record<string, unknown>;

  return (
    typeof obj.version === "number" &&
    typeof obj.id === "string" &&
    typeof obj.createdAt === "string" &&
    typeof obj.label === "string" &&
    typeof obj.systemExport === "string"
  );
}
