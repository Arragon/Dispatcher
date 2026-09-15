export function normalizeCliArguments(rawArguments: string[]): string[] {
  return rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments;
}
