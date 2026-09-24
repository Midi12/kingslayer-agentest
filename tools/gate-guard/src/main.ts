/** Composition root of gate-guard. */
import { GitRepository, NodeGuardIo, guardCli } from './index.js';

export function guardMain(argv: readonly string[], cwd: string = process.cwd()): Promise<number> {
  return guardCli(argv, {
    io: new NodeGuardIo(),
    openRepository: (directory) => new GitRepository(directory ?? cwd),
  });
}
