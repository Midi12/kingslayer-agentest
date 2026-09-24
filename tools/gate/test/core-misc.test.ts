import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LineTail,
  MARKER_PATTERNS,
  isScannedFile,
  notRunReason,
  parseRequirement,
  scanForMarkers,
} from '../src/index.js';
import { parseDepcruiseArgs, parseG0Args, parseGateArgs } from '../src/core/cli-args.js';

const joined = (...parts: string[]): string => parts.join('');

describe('LineTail', () => {
  it('keeps the last lines across chunk boundaries', () => {
    const tail = new LineTail(3);
    expect(tail.push('a\nb')).toEqual(['a']);
    expect(tail.push('c\r\nd\ne\n')).toEqual(['bc', 'd', 'e']);
    expect(tail.push('f')).toEqual([]);
    expect(tail.end()).toEqual(['f']);
    expect(tail.end()).toEqual([]);
    expect(tail.lines()).toEqual(['d', 'e', 'f']);
    expect(tail.totalLines()).toBe(5);
  });

  it('never glues lines of different streams together', () => {
    const tail = new LineTail(10);
    tail.push('out-par', 'stdout');
    expect(tail.push('err\n', 'stderr')).toEqual(['err']);
    expect(tail.push('tial\nx', 'stdout')).toEqual(['out-partial']);
    tail.push('y', 'stderr');
    expect(tail.end()).toEqual(['x', 'y']);
    expect(tail.lines()).toEqual(['err', 'out-partial', 'x', 'y']);
  });
});

describe('scanForMarkers', () => {
  it('finds every forbidden marker', () => {
    const text = [
      `// ${joined('TO', 'DO')}: later`,
      `/* ${joined('FIX', 'ME')} */`,
      `${joined('it', '.sk', 'ip')}('x', () => {});`,
      `${joined('describe', '.sk', 'ip')}('x', () => {});`,
      `${joined('test', '.sk', 'ipIf')}(true)('x', () => {});`,
      `${joined('it', '.on', 'ly')}('x', () => {});`,
      `${joined('describe', '.on', 'ly')}('x', () => {});`,
      `${joined('x', 'it')}('x', () => {});`,
      `${joined('x', 'describe')}('x', () => {});`,
      `${joined('x', 'test')}('x', () => {});`,
      `${joined('it', '.to', 'do')}('x');`,
      'const clean = 1;',
    ].join('\n');
    const hits = scanForMarkers('a.ts', text);
    expect(hits.map((hit) => hit.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(hits[0]).toEqual({
      file: 'a.ts',
      line: 1,
      marker: joined('TO', 'DO'),
      text: `// ${joined('TO', 'DO')}: later`,
    });
    expect(new Set(hits.map((hit) => hit.marker)).size).toBe(MARKER_PATTERNS.length);
  });

  it('does not flag look-alikes', () => {
    const text = [
      'const todos = [];',
      'exit(0);',
      'fixme()',
      'skipped = true',
      'onlyOnce()',
      'mixit(1)',
    ].join('\n');
    expect(scanForMarkers('b.ts', text)).toEqual([]);
  });

  it('finds nothing in the gate tool itself', () => {
    const src = join(import.meta.dirname, '..', 'src');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    const files = walk(src);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(scanForMarkers(file, readFileSync(file, 'utf8'))).toEqual([]);
    }
  });

  it('scans text files by extension', () => {
    expect(isScannedFile('src/a.ts')).toBe(true);
    expect(isScannedFile('test/fixtures/gates/M91.yaml')).toBe(true);
    expect(isScannedFile('image.png')).toBe(false);
  });
});

describe('requirements', () => {
  it('distinguishes environment variables and tools', () => {
    expect(parseRequirement('TYPESAFE_API_KEY')).toEqual({ kind: 'env', name: 'TYPESAFE_API_KEY' });
    expect(parseRequirement('docker')).toEqual({ kind: 'tool', name: 'docker' });
    expect(parseRequirement('env:lower_case')).toEqual({ kind: 'env', name: 'lower_case' });
    expect(parseRequirement('tool:HELM')).toEqual({ kind: 'tool', name: 'HELM' });
    expect(parseRequirement('Mixed')).toEqual({ kind: 'tool', name: 'Mixed' });
  });

  it('names what is missing', () => {
    const env = parseRequirement('ARGUS_LLM_API_KEY');
    const tool = parseRequirement('docker');
    expect(notRunReason([{ requirement: env, satisfied: true }])).toBeUndefined();
    expect(
      notRunReason([
        { requirement: env, satisfied: false },
        { requirement: parseRequirement('TYPESAFE_API_KEY'), satisfied: false },
        { requirement: tool, satisfied: false, detail: 'docker daemon unreachable' },
        { requirement: parseRequirement('kind'), satisfied: false },
      ]),
    ).toBe(
      'missing credentials: ARGUS_LLM_API_KEY, TYPESAFE_API_KEY; missing tools: docker (docker daemon unreachable), kind',
    );
  });
});

describe('parseGateArgs', () => {
  it('parses runs', () => {
    expect(parseGateArgs(['M00'])).toEqual({
      ok: true,
      value: {
        kind: 'run',
        target: 'M00',
        tier: undefined,
        evidenceDir: undefined,
        gatesDir: undefined,
        strict: false,
        verbose: false,
      },
    });
    expect(
      parseGateArgs([
        'all',
        '--tier',
        'A',
        '--evidence-dir',
        'e',
        '--gates-dir',
        'g',
        '--strict',
        '--verbose',
      ]),
    ).toEqual({
      ok: true,
      value: {
        kind: 'run',
        target: 'all',
        tier: 'A',
        evidenceDir: 'e',
        gatesDir: 'g',
        strict: true,
        verbose: true,
      },
    });
    expect(parseGateArgs(['verify', 'a.json', 'b.json'])).toEqual({
      ok: true,
      value: { kind: 'verify', files: ['a.json', 'b.json'] },
    });
    expect(parseGateArgs(['--help'])).toEqual({ ok: true, value: { kind: 'help' } });
  });

  it.each([
    [[], /missing <MOD\|all>/],
    [['M0'], /invalid module M0/],
    [['M00', 'M01'], /unexpected argument M01/],
    [['M00', '--tier', 'D'], /--tier needs one of A, B, C/],
    [['M00', '--tier'], /--tier needs/],
    [['M00', '--evidence-dir'], /--evidence-dir needs a directory/],
    [['M00', '--gates-dir'], /--gates-dir needs a directory/],
    [['M00', '--fast'], /unknown option --fast/],
    [['verify'], /verify needs at least one evidence file/],
  ])('rejects %j', (argv, message) => {
    const parsed = parseGateArgs(argv);
    expect(parsed.ok ? '' : parsed.error).toMatch(message);
  });
});

describe('parseG0Args and parseDepcruiseArgs', () => {
  it('parses g0 arguments', () => {
    expect(parseG0Args(['packages/a', 'tools/b'])).toEqual({
      ok: true,
      value: { packages: ['packages/a', 'tools/b'] },
    });
    expect(parseG0Args(['-h'])).toEqual({ ok: true, value: 'help' });
    expect(parseG0Args([])).toEqual({ ok: false, error: 'name at least one package directory' });
    expect(parseG0Args(['a', '--x'])).toEqual({ ok: false, error: 'unknown option --x' });
  });

  it('parses depcruise arguments', () => {
    expect(parseDepcruiseArgs([])).toEqual({ ok: true, value: { paths: [], jsonFile: undefined } });
    expect(parseDepcruiseArgs(['--json', 'r.json', 'a', 'b'])).toEqual({
      ok: true,
      value: { paths: ['a', 'b'], jsonFile: 'r.json' },
    });
    expect(parseDepcruiseArgs(['--help'])).toEqual({ ok: true, value: 'help' });
    expect(parseDepcruiseArgs(['--json'])).toEqual({ ok: false, error: '--json needs a file' });
    expect(parseDepcruiseArgs(['--exclude', 'x'])).toEqual({
      ok: false,
      error: 'unknown option --exclude',
    });
  });
});
