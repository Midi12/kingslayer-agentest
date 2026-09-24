/** Shared by the two halves of M01-G4 (`gate-g4.test.ts` and `gate-g4.git.ts`). */
import { exportJsonSchemas } from '../../src/index.js';

/** The JSON Schema files generated from the registry, keyed by file name. */
export function currentSchemas(): Map<string, unknown> {
  return new Map([...exportJsonSchemas()].map(([file, schema]) => [file, schema as unknown]));
}
