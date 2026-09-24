import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DepcruiseDeps, FIXTURE_EXCLUDE, NodeFileSystem, depcruiseCli } from '../src/index.js';
import { summaryErrors } from '../src/app/depcruise.js';
import { MemoryOutput, ScriptedProcessRunner } from './support.js';

let root = '';
let output = new MemoryOutput();

function runner(errors: number | 'none') {
  return new ScriptedProcessRunner((request) => {
    const tool = basename(request.argv[0] ?? '');
    if (tool === 'depcruise' && errors !== 'none') {
      const target = request.argv[request.argv.indexOf('--output-to') + 1] ?? '';
      writeFileSync(target, JSON.stringify({ summary: { error: errors } }));
    }
    return { exitCode: 0, tail: [`${tool} ran`] };
  });
}

function deps(processes: ScriptedProcessRunner): DepcruiseDeps {
  return { fs: new NodeFileSystem(), processes, output, env: {}, root, configExcludes: ['^dist/'] };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'argus-depcruise-'));
  output = new MemoryOutput();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('depcruiseCli', () => {
  it('checks the existing real-tree roots without test fixtures', async () => {
    mkdirSync(join(root, 'packages'));
    mkdirSync(join(root, 'tools'));
    const processes = runner(0);
    expect(await depcruiseCli([], deps(processes))).toBe(0);
    const cruise = processes.requests[0]?.argv ?? [];
    expect(cruise.slice(-2)).toEqual(['packages', 'tools']);
    expect(cruise[cruise.indexOf('--exclude') + 1]).toBe(`^dist/|${FIXTURE_EXCLUDE}`);
    expect(basename(processes.requests[1]?.argv[0] ?? '')).toBe('depcruise-fmt');
    expect(output.lines).toContain('depcruise-fmt ran');
  });

  it('checks exactly the given paths and fails on violations', async () => {
    const processes = runner(2);
    const report = join(root, 'report.json');
    expect(await depcruiseCli(['--json', report, 'fixtures/a'], deps(processes))).toBe(1);
    const cruise = processes.requests[0]?.argv ?? [];
    expect(cruise).not.toContain('--exclude');
    expect(cruise.at(-1)).toBe('fixtures/a');
    expect(cruise[cruise.indexOf('--output-to') + 1]).toBe(report);
  });

  it('exits 2 when no report is produced, on usage errors, and 0 for help', async () => {
    expect(await depcruiseCli(['x'], deps(runner('none')))).toBe(2);
    expect(output.text()).toMatch(/no report was produced/);
    expect(await depcruiseCli(['--nope'], deps(runner(0)))).toBe(2);
    expect(await depcruiseCli(['--help'], deps(runner(0)))).toBe(0);
  });

  it('reads the error count of a report', () => {
    expect(summaryErrors('{"summary":{"error":3}}')).toBe(3);
    expect(summaryErrors('{"summary":{}}')).toBeUndefined();
    expect(summaryErrors('{')).toBeUndefined();
    expect(summaryErrors(null)).toBeUndefined();
  });
});
