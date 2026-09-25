// The CLI's entry file: TypeScript when running from source, JavaScript once built. Muse starts
// itself, and the final render, as their own processes through it.

import { fileURLToPath } from 'node:url';

export const cliEntry = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './index.ts' : './index.js', import.meta.url));
