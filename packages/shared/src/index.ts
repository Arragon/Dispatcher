export const moduleBoundary = {
  id: "shared",
  status: "active",
  milestone: "M0",
} as const;

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

/** Task/provider children need their native context, never Controller authority. */
export function childExecutionEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  overrides: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  return Object.fromEntries(Object.entries({ ...inherited, ...overrides }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !["DISPATCHER_OWNER_TOKEN", "DISPATCHER_SECRET_STORE_KEY"].includes(entry[0].toUpperCase()),
  ));
}
