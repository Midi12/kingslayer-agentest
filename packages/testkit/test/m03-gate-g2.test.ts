/**
 * M03-G2: probabilities are well-formed. 1,000 generated requests go through the SDK to
 * the fake in oracle mode: Choice and Score probabilities sum to 1 ± 1e-6, every
 * probability, confidence and Noul value lies in [0, 1], confidence follows
 * (n·p_max − 1)/(n − 1), noise 0 gives the truth with probability 1, and the same seed
 * gives the same answer (on a second server started with that seed).
 */
import { TypeSafeClient, type SystemOneRequest } from '@typesafe-ai/sdk';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_FAKE_JEV_API_KEY,
  startFakeJev,
  type FakeJevServer,
  type JevAnswer,
  type OracleTruth,
} from '../src/index.js';
import { recordGateMetrics } from '../src/gate-metrics.js';

const RUNS = 1000;
const SEED = 20260924;

const metrics = {
  requests: 0,
  choiceSumViolations: 0,
  scoreSumViolations: 0,
  rangeViolations: 0,
  confidenceFormulaViolations: 0,
  determinismViolations: 0,
  noiseZeroCases: 0,
  noiseZeroTruthViolations: 0,
  seedChanged: 0,
};

afterAll(() => {
  recordGateMetrics({
    requests: metrics.requests,
    choiceSumViolations: metrics.choiceSumViolations,
    scoreSumViolations: metrics.scoreSumViolations,
    rangeViolations: metrics.rangeViolations,
    confidenceFormulaViolations: metrics.confidenceFormulaViolations,
    determinismViolations: metrics.determinismViolations,
    noiseZeroCases: metrics.noiseZeroCases,
    noiseZeroTruthViolations: metrics.noiseZeroTruthViolations,
    seedSensitive: metrics.seedChanged > 0,
  });
});

/** The truth travels in the state, so one truth function serves every generated request. */
interface Case {
  readonly noise: number;
  readonly questions: Record<
    string,
    | { type: 'choice'; labels: string[]; truth: string[] | null }
    | { type: 'noul'; truth: boolean | null }
    | { type: 'score'; levels: number; truth: number | null }
  >;
}

const label = fc.stringMatching(/^[a-z][a-z0-9_]{0,11}$/);

const choiceCase = fc.uniqueArray(label, { minLength: 1, maxLength: 60 }).chain((labels) =>
  fc.record({
    type: fc.constant('choice' as const),
    labels: fc.constant(labels),
    truth: fc.option(fc.subarray(labels, { minLength: 1, maxLength: Math.min(3, labels.length) }), {
      nil: null,
    }),
  }),
);
const noulCase = fc.record({
  type: fc.constant('noul' as const),
  truth: fc.option(fc.boolean(), { nil: null }),
});
const scoreCase = fc.integer({ min: 2, max: 10 }).chain((levels) =>
  fc.record({
    type: fc.constant('score' as const),
    levels: fc.constant(levels),
    truth: fc.option(fc.integer({ min: 0, max: levels - 1 }), { nil: null }),
  }),
);

const caseArbitrary: fc.Arbitrary<Case> = fc.record({
  noise: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 1, noNaN: true })),
  questions: fc.dictionary(
    fc.stringMatching(/^q_[a-z0-9]{1,8}$/),
    fc.oneof(choiceCase, noulCase, scoreCase),
    {
      minKeys: 1,
      maxKeys: 5,
    },
  ),
});

function toRequest(testCase: Case): SystemOneRequest {
  const questions: SystemOneRequest['questions'] = {};
  const truths: Record<string, OracleTruth> = {};
  for (const [key, q] of Object.entries(testCase.questions)) {
    if (q.type === 'choice') {
      questions[key] = {
        type: 'choice',
        instructions: `Pick for ${key}`,
        criteria: Object.fromEntries(q.labels.map((l) => [l, `option ${l}`])),
      };
      truths[key] = q.truth;
    } else if (q.type === 'noul') {
      questions[key] = { type: 'noul', instructions: `Is ${key} true?` };
      truths[key] = q.truth;
    } else {
      questions[key] = {
        type: 'score',
        instructions: `Rate ${key}`,
        criteria: Array.from(
          { length: q.levels },
          (_, i) => `level ${String(i)}`,
        ) as unknown as readonly [string, string],
      };
      truths[key] = q.truth;
    }
  }
  return { model: 'jev-1.13.0', state: { truths, noise: testCase.noise } as never, questions };
}

const within = (value: number): boolean => value >= 0 && value <= 1;

function check(testCase: Case, answers: Record<string, JevAnswer>, noise: number): void {
  for (const [key, q] of Object.entries(testCase.questions)) {
    const answer = answers[key];
    if (answer === undefined) {
      metrics.rangeViolations += 1;
      continue;
    }
    if (answer.type === 'noul') {
      if (!within(answer.noul)) metrics.rangeViolations += 1;
      if (noise === 0 && q.type === 'noul' && q.truth !== null) {
        metrics.noiseZeroCases += 1;
        if (answer.noul !== (q.truth ? 1 : 0)) metrics.noiseZeroTruthViolations += 1;
      }
      continue;
    }
    const probabilities = Object.values(answer.probabilities);
    const sum = probabilities.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-6) {
      if (answer.type === 'choice') metrics.choiceSumViolations += 1;
      else metrics.scoreSumViolations += 1;
    }
    if (!probabilities.every(within) || !within(answer.confidence)) metrics.rangeViolations += 1;
    const n = probabilities.length;
    const expected = n === 1 ? 1 : (n * Math.max(...probabilities) - 1) / (n - 1);
    if (Math.abs(answer.confidence - Math.min(1, Math.max(0, expected))) > 1e-9) {
      metrics.confidenceFormulaViolations += 1;
    }
    if (answer.type === 'choice') {
      const best = Math.max(...probabilities);
      if (answer.probabilities[answer.choice] !== best) metrics.confidenceFormulaViolations += 1;
      if (noise === 0 && q.type === 'choice' && q.truth !== null) {
        metrics.noiseZeroCases += 1;
        const truthMass = q.truth.reduce((total, l) => total + (answer.probabilities[l] ?? 0), 0);
        if (Math.abs(truthMass - 1) > 1e-12 || !q.truth.includes(answer.choice))
          metrics.noiseZeroTruthViolations += 1;
      }
    } else if (q.type === 'score') {
      if (!(answer.score >= 0 && answer.score <= q.levels - 1)) metrics.rangeViolations += 1;
      if (noise === 0 && q.truth !== null) {
        metrics.noiseZeroCases += 1;
        if (answer.score !== q.truth || answer.probabilities[String(q.truth)] !== 1)
          metrics.noiseZeroTruthViolations += 1;
      }
    }
  }
}

describe('M03-G2 oracle probabilities over 1,000 generated requests', () => {
  const servers: FakeJevServer[] = [];
  afterAll(async () => {
    await Promise.all(servers.map((server) => server.close()));
  });

  it('are well-formed, follow the confidence formula, and replay for the same seed', async () => {
    // Amplitude is a server option, so the property runs one server pair per amplitude.
    const pool = new Map<
      number,
      { first: TypeSafeClient; second: TypeSafeClient; other: TypeSafeClient }
    >();
    async function clientsFor(noise: number) {
      const existing = pool.get(noise);
      if (existing !== undefined) return existing;
      const make = async (seed: number) => {
        const server = await startFakeJev({
          mode: {
            kind: 'oracle',
            seed,
            noise,
            truth: (request) => (request.state as { truths: Record<string, OracleTruth> }).truths,
          },
        });
        servers.push(server);
        return new TypeSafeClient({
          apiKey: DEFAULT_FAKE_JEV_API_KEY,
          baseURL: server.url,
          logLevel: 'off',
          retry: { maxRetries: 0 },
        });
      };
      const entry = {
        first: await make(SEED),
        second: await make(SEED),
        other: await make(SEED + 1),
      };
      pool.set(noise, entry);
      return entry;
    }

    await fc.assert(
      fc.asyncProperty(caseArbitrary, async (testCase) => {
        const noise = Math.round(testCase.noise * 8) / 8; // eight amplitude classes plus 0
        const clients = await clientsFor(noise);
        const body = toRequest(testCase);
        const first = await clients.first.systemOne(body);
        metrics.requests += 1;
        check(testCase, first.answers, noise);
        const again = await clients.second.systemOne(body);
        if (JSON.stringify(again.answers) !== JSON.stringify(first.answers))
          metrics.determinismViolations += 1;
        if (noise > 0) {
          const other = await clients.other.systemOne(body);
          if (JSON.stringify(other.answers) !== JSON.stringify(first.answers))
            metrics.seedChanged += 1;
        }
      }),
      { numRuns: RUNS, seed: SEED },
    );
    expect(metrics.requests).toBe(RUNS);
    expect(metrics.choiceSumViolations + metrics.scoreSumViolations + metrics.rangeViolations).toBe(
      0,
    );
    expect(metrics.confidenceFormulaViolations).toBe(0);
    expect(metrics.determinismViolations).toBe(0);
    expect(metrics.noiseZeroTruthViolations).toBe(0);
    expect(metrics.seedChanged).toBeGreaterThan(0);
  }, 300_000);
});
