// Lets a bin run from TypeScript sources with no build: tsx compiles the sources, and a
// resolve hook adds the `@argus/source` export condition, so workspace packages resolve
// to their `src` too (the same condition tsconfig.base.json and Vitest enable).
import { register as registerHooks } from 'node:module';
import { register as registerTsx } from 'tsx/esm/api';

export const SOURCE_CONDITION = '@argus/source';

const sourceConditionHook = `
const condition = ${JSON.stringify(SOURCE_CONDITION)};
export async function resolve(specifier, context, nextResolve) {
  const conditions = context.conditions ?? [];
  if (conditions.includes(condition)) {
    return nextResolve(specifier, context);
  }
  return nextResolve(specifier, { ...context, conditions: [...conditions, condition] });
}
`;

/** Registers tsx, then the condition hook; hooks registered later run first. */
export function registerSourceRuntime() {
  registerTsx();
  registerHooks(`data:text/javascript,${encodeURIComponent(sourceConditionHook)}`);
}
