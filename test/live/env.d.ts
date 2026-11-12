// The live test reads its key from the environment; Vitest runs it in Node.
declare const process: { env: Record<string, string | undefined> };
