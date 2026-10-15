import type { Project, Task, TaskContract } from "@dispatcher/domain";
import type { RepositoryConfig } from "@dispatcher/config";
import type { FleetProjectInput } from "@dispatcher/fleet";

/** Links are presentation metadata, never an authority or credential transport. */
export function publicWebUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString();
  } catch { return undefined; }
}

export function publicRepositoryAddress(value: unknown): string | undefined {
  const web = publicWebUrl(value);
  if (web || typeof value !== "string") return web;
  const scp = /^git@([a-zA-Z0-9.-]+):(.+)$/.exec(value);
  try {
    const url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : value);
    if (url.protocol !== "ssh:") return undefined;
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString();
  } catch { return undefined; }
}

export function projectViews(tasks: readonly Task[], projects: readonly Project[], repositories: readonly RepositoryConfig[], contract: (taskId: string) => TaskContract | undefined): FleetProjectInput[] {
  const ids = new Set([...projects.map((project) => project.id), ...tasks.map((task) => task.projectId)]);
  return [...ids].sort().map((id) => {
    const canonical = projects.find((project) => project.id === id);
    const members = tasks.filter((task) => task.projectId === id);
    const extensions = members.map((task) => task.platformExtensions?.linear).filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"));
    const repositoryIds = new Set(members.map((task) => contract(task.id)?.delivery.repository).filter((value): value is string => Boolean(value)));
    if (canonical?.repository) repositoryIds.add(canonical.repository);
    const registered = repositories.filter((repository) => repositoryIds.has(repository.id));
    const refs = (canonical?.bindings ?? []).flatMap((binding) => {
      const externalUrl = publicWebUrl(binding.externalUrl);
      return externalUrl ? [{ connectorInstanceId: binding.connectorInstanceId, externalId: binding.externalId, externalUrl }] : [];
    });
    for (const task of members) {
      const linear = task.platformExtensions?.linear as Record<string, unknown> | undefined;
      const externalUrl = publicWebUrl(linear?.projectUrl);
      const connectorInstanceId = task.bindings?.[0]?.connectorInstanceId;
      if (externalUrl && !refs.some((ref) => ref.externalUrl === externalUrl)) refs.push({ connectorInstanceId: connectorInstanceId ?? "linear", externalId: id, externalUrl });
    }
    const name = canonical?.name ?? extensions.find((value) => typeof value.projectName === "string")?.projectName;
    return { id, name: typeof name === "string" ? name : id, repositories: registered.map((repository) => ({ id: repository.id, root: repository.root, ...(publicRepositoryAddress(repository.remote) ? { remote: publicRepositoryAddress(repository.remote)! } : {}) })), externalRefs: refs };
  });
}
