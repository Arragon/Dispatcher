import type { ConnectorKind } from "@dispatcher/domain";
import type { ConnectorAdapter } from "./contracts.js";

export class ConnectorRegistry {
  private readonly adapters = new Map<string, ConnectorAdapter>();

  register(adapter: ConnectorAdapter): void {
    if (adapter.definition.kind !== adapter.instance.kind || adapter.definition.id !== adapter.instance.definitionId) {
      throw new Error("Connector instance does not match its definition");
    }
    if (this.adapters.has(adapter.instance.id)) throw new Error(`Connector instance ${adapter.instance.id} is already registered`);
    this.adapters.set(adapter.instance.id, adapter);
  }

  get<T extends ConnectorAdapter = ConnectorAdapter>(id: string): T | undefined {
    return this.adapters.get(id) as T | undefined;
  }

  require<T extends ConnectorAdapter = ConnectorAdapter>(id: string, kind?: ConnectorKind): T {
    const adapter = this.get<T>(id);
    if (!adapter) throw new Error(`Unknown connector instance ${id}`);
    if (kind && adapter.instance.kind !== kind) throw new Error(`Connector ${id} is not a ${kind} connector`);
    return adapter;
  }

  list(kind?: ConnectorKind): ConnectorAdapter[] {
    return [...this.adapters.values()].filter((adapter) => !kind || adapter.instance.kind === kind);
  }

  clear(): void {
    this.adapters.clear();
  }
}
