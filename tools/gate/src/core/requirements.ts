/**
 * Gate requirements: environment variables or tools. `env:NAME` and `tool:name` are
 * explicit; otherwise an UPPER_SNAKE_CASE name is an environment variable and anything
 * else is a tool found with `command -v`. The tool `docker` also needs a reachable daemon.
 */
export type Requirement =
  | { readonly kind: 'env'; readonly name: string }
  | { readonly kind: 'tool'; readonly name: string };

export const REQUIREMENT_PATTERN = '^((env|tool):)?[A-Za-z_][A-Za-z0-9_.+-]*$';

export function parseRequirement(text: string): Requirement {
  if (text.startsWith('env:')) {
    return { kind: 'env', name: text.slice(4) };
  }
  if (text.startsWith('tool:')) {
    return { kind: 'tool', name: text.slice(5) };
  }
  return /^[A-Z][A-Z0-9_]*$/.test(text)
    ? { kind: 'env', name: text }
    : { kind: 'tool', name: text };
}

export interface RequirementCheck {
  readonly requirement: Requirement;
  readonly satisfied: boolean;
  /** Why an unsatisfied requirement failed, for example "docker daemon unreachable". */
  readonly detail?: string;
}

/** The not_run reason for a set of checks, or undefined when every requirement holds. */
export function notRunReason(checks: readonly RequirementCheck[]): string | undefined {
  const missing = checks.filter((check) => !check.satisfied);
  if (missing.length === 0) {
    return undefined;
  }
  const env = missing.filter((check) => check.requirement.kind === 'env');
  const tools = missing.filter((check) => check.requirement.kind === 'tool');
  const parts: string[] = [];
  if (env.length > 0) {
    parts.push(`missing credentials: ${env.map((check) => check.requirement.name).join(', ')}`);
  }
  if (tools.length > 0) {
    parts.push(
      `missing tools: ${tools
        .map((check) =>
          check.detail === undefined
            ? check.requirement.name
            : `${check.requirement.name} (${check.detail})`,
        )
        .join(', ')}`,
    );
  }
  return parts.join('; ');
}
