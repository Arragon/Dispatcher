export const moduleBoundary = {
  id: "shared",
  status: "active",
  milestone: "M0",
} as const;

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
