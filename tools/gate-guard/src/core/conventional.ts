/** Conventional commit subjects, scoped by module: `feat(M06): stage-two confirmation`. */
export const CONVENTIONAL_TYPES = [
  'feat',
  'fix',
  'chore',
  'docs',
  'test',
  'refactor',
  'perf',
  'build',
  'ci',
  'style',
  'revert',
] as const;

const SUBJECT = new RegExp(`^(${CONVENTIONAL_TYPES.join('|')})(\\([A-Za-z0-9._/-]+\\))?!?: \\S`);

export function isConventionalSubject(subject: string): boolean {
  return SUBJECT.test(subject);
}
