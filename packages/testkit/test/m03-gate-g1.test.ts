/**
 * M03-G1: the official SDK cannot tell the difference. `@typesafe-ai/sdk`, pointed at the
 * fake through `baseURL`, completes Choice, Score and Noul requests in all three modes
 * (scripted, oracle, cassette) and parses every response; the errors it documents reach
 * the SDK as the error classes it declares.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { APIError } from '@typesafe-ai/sdk';
import {
  AuthenticationError,
  InternalServerError,
  NotFoundError,
  RateLimitError,
  TypeSafeClient,
  UnprocessableEntityError,
  choice,
  noul,
  score,
  type Fetch,
  type SystemOneRequest,
} from '@typesafe-ai/sdk';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_FAKE_JEV_API_KEY,
  FileCassetteStore,
  createCassetteFetch,
  estimateJevInputTokens,
  oracleFromTargets,
  startFakeJev,
  type FakeJevServer,
} from '../src/index.js';
import { recordGateMetrics } from '../src/gate-metrics.js';

const metrics = {
  modes: new Set<string>(),
  choiceAnswers: 0,
  scoreAnswers: 0,
  noulAnswers: 0,
  parseFailures: 0,
  shapeMismatches: 0,
  requestIdMissing: 0,
  modelListed: false,
  errorCases: 0,
  errorClassMismatches: 0,
  usageMismatches: 0,
};

afterAll(() => {
  recordGateMetrics({
    modes: metrics.modes.size,
    choiceAnswers: metrics.choiceAnswers,
    scoreAnswers: metrics.scoreAnswers,
    noulAnswers: metrics.noulAnswers,
    parseFailures: metrics.parseFailures,
    shapeMismatches: metrics.shapeMismatches,
    requestIdMissing: metrics.requestIdMissing,
    modelListed: metrics.modelListed,
    errorCases: metrics.errorCases,
    errorClassMismatches: metrics.errorClassMismatches,
    usageMismatches: metrics.usageMismatches,
  });
});

// The SystemOneResult shape of the SDK's index.d.mts, as a closed schema.
const Probabilities = Type.Record(Type.String(), Type.Number({ minimum: 0, maximum: 1 }));
const Answer = Type.Union([
  Type.Object(
    { type: Type.Literal('noul'), noul: Type.Number({ minimum: 0, maximum: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('choice'),
      choice: Type.String(),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
      probabilities: Probabilities,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('score'),
      score: Type.Number({ minimum: 0 }),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
      legend: Type.Record(Type.String(), Type.Unknown()),
      probabilities: Probabilities,
    },
    { additionalProperties: false },
  ),
]);
const SystemOneResult = Type.Object(
  {
    model: Type.String(),
    answers: Type.Record(Type.String(), Answer),
    usage: Type.Object(
      { input_tokens: Type.Integer({ minimum: 0 }), output_tokens: Type.Integer({ minimum: 0 }) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const candidates = {
  c16: 'button Start; row C11 | Stopped | 0.0 m/s; region Conveyor table',
  c17: 'button Start; row C12 | Stopped | 0.0 m/s; region Conveyor table',
  c18: 'button Stop; row C12 | Stopped | 0.0 m/s; region Conveyor table',
};

function request() {
  return {
    model: 'jev-1.13.0',
    state: {
      step: {
        intent: 'Start conveyor C12',
        action: 'click',
        target: 'Start button in the row of conveyor C12',
      },
      candidates: {
        c16: { role: 'button', name: 'Start', row: 'C11 | Stopped | 0.0 m/s' },
        c17: { role: 'button', name: 'Start', row: 'C12 | Stopped | 0.0 m/s' },
        c18: { role: 'button', name: 'Stop', row: 'C12 | Stopped | 0.0 m/s' },
      },
    },
    questions: {
      target: choice(
        'Which option is the user-interface element described by `step.target`?',
        candidates,
      ),
      target_present: noul('Does `candidates` contain the element described by `step.target`?', {
        true: 'At least one candidate is the described element.',
        false: 'No candidate is the described element.',
      }),
      severity: score('How severe is the state of conveyor C12?', [
        'normal',
        'degraded',
        'stopped',
      ] as const),
    },
  } satisfies SystemOneRequest;
}

function client(url: string, extra: { fetch?: Fetch; apiKey?: string } = {}): TypeSafeClient {
  return new TypeSafeClient({
    apiKey: extra.apiKey ?? DEFAULT_FAKE_JEV_API_KEY,
    baseURL: url,
    logLevel: 'off',
    retry: { maxRetries: 0 },
    ...(extra.fetch === undefined ? {} : { fetch: extra.fetch }),
  });
}

/** Runs one Choice + Noul + Score request through the SDK and checks every answer. */
async function exercise(mode: string, sdk: TypeSafeClient, server: FakeJevServer) {
  const body = request();
  const { data, requestId } = await sdk.systemOne(body).withResponse();
  if (requestId === undefined || !/^req_\d{4}$/.test(requestId)) {
    metrics.requestIdMissing += 1;
  }
  if (!Value.Check(SystemOneResult, data)) {
    metrics.shapeMismatches += 1;
  }
  const target = data.answers.target;
  const present = data.answers.target_present;
  const severity = data.answers.severity;
  // The static types come from the request; check what actually came over the wire.
  const wire = data.answers as unknown as Record<string, Record<string, unknown> | undefined>;
  const labelsOk =
    Object.keys(target.probabilities).join() === Object.keys(candidates).join() &&
    target.choice in candidates;
  const levelsOk =
    Object.keys(severity.legend).join() === '0,1,2' &&
    (severity.legend as Record<string, unknown>)['0'] === 'normal' &&
    Object.keys(severity.probabilities).join() === '0,1,2';
  if (
    !labelsOk ||
    !levelsOk ||
    wire.target?.type !== 'choice' ||
    wire.target_present?.type !== 'noul' ||
    wire.severity?.type !== 'score' ||
    typeof present.noul !== 'number'
  ) {
    metrics.parseFailures += 1;
  } else {
    metrics.choiceAnswers += 1;
    metrics.noulAnswers += 1;
    metrics.scoreAnswers += 1;
  }
  const expectedTokens = estimateJevInputTokens(body);
  if (data.usage.input_tokens !== expectedTokens || data.usage.output_tokens !== 0) {
    metrics.usageMismatches += 1;
  }
  expect(data.model).toBe('jev-1.13.0');
  expect(server.requests.at(-1)?.requestId).toBe(requestId);
  metrics.modes.add(mode);
  return data;
}

async function expectError(
  promise: Promise<unknown>,
  errorClass: abstract new (...args: never[]) => APIError,
  status: number,
): Promise<APIError> {
  metrics.errorCases += 1;
  try {
    await promise;
  } catch (error) {
    if (error instanceof errorClass && error.status === status && error.requestId !== undefined) {
      return error;
    }
    metrics.errorClassMismatches += 1;
    throw error;
  }
  metrics.errorClassMismatches += 1;
  throw new Error(`expected ${errorClass.name} ${String(status)}`);
}

describe('M03-G1 scripted mode', () => {
  it('answers Choice, Noul and Score through the SDK, and lists the pinned model', async () => {
    const server = await startFakeJev({
      mode: {
        kind: 'scripted',
        script: {
          answers: {
            target: { choice: 'c17', confidence: 0.9 },
            target_present: 0.97,
            severity: { probabilities: { '0': 0.1, '1': 0.2, '2': 0.7 } },
          },
        },
      },
    });
    try {
      const sdk = client(server.url);
      const data = await exercise('scripted', sdk, server);
      expect(data.answers.target.choice).toBe('c17');
      expect(data.answers.target.confidence).toBeCloseTo(0.9, 12);
      expect(data.answers.target_present.noul).toBe(0.97);
      expect(data.answers.severity.score).toBeCloseTo(1.6, 12);
      const models = await sdk.models.list();
      metrics.modelListed = models.some(
        (model) =>
          model.name === 'jev-1.13.0' &&
          typeof model.description === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(model.release_date),
      );
      expect(metrics.modelListed).toBe(true);
    } finally {
      await server.close();
    }
  });
});

describe('M03-G1 oracle mode', () => {
  it('answers from the truth function, and noise 0 gives the truth with probability 1', async () => {
    const truth = oracleFromTargets(
      { 'Start button in the row of conveyor C12': 'c17' },
      {
        fallback: () => ({ severity: 2 }),
      },
    );
    const server = await startFakeJev({ mode: { kind: 'oracle', truth, noise: 0, seed: 7 } });
    try {
      const data = await exercise('oracle', client(server.url), server);
      expect(data.answers.target.choice).toBe('c17');
      expect(data.answers.target.probabilities.c17).toBe(1);
      expect(data.answers.target.confidence).toBe(1);
      expect(data.answers.target_present.noul).toBe(1);
      expect(data.answers.severity.score).toBe(2);
    } finally {
      await server.close();
    }
  });
});

describe('M03-G1 cassette mode', () => {
  it('replays a recording made through the SDK, byte for byte in content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argus-m03-g1-'));
    const live = await startFakeJev({
      mode: {
        kind: 'scripted',
        script: { answers: { target: 'c16', target_present: false, severity: 0 } },
      },
    });
    try {
      const recorder = createCassetteFetch({ store: dir, mode: 'record' });
      const recorded = await client(live.url, { fetch: recorder }).systemOne(request());
      expect(recorder.stats.recorded).toBe(1);
      await live.close();

      const replay = await startFakeJev({
        mode: { kind: 'cassette', store: new FileCassetteStore(dir) },
      });
      try {
        const data = await exercise('cassette', client(replay.url), replay);
        expect(data).toEqual(recorded);
        expect(replay.requests.at(-1)?.outcome).toBe('replayed');
        await expectError(
          client(replay.url).systemOne({ ...request(), state: 'a state never recorded' }),
          NotFoundError,
          404,
        );
      } finally {
        await replay.close();
      }
    } finally {
      await live.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('M03-G1 documented errors reach the SDK as its error classes', () => {
  it('401 on a missing or wrong key, 422 on invalid requests, 429 and 529 on demand', async () => {
    const server = await startFakeJev({
      mode: {
        kind: 'scripted',
        script: { answers: { target: 'c17', target_present: true, severity: 1, wide: 'o254' } },
      },
    });
    try {
      const url = server.url;
      await expectError(
        client(url, { apiKey: 'wrong-key' }).systemOne(request()),
        AuthenticationError,
        401,
      );
      const missing = await fetch(`${url}/v1/systemone`, {
        method: 'POST',
        body: JSON.stringify(request()),
      });
      metrics.errorCases += 1;
      if (missing.status !== 401 || missing.headers.get('x-typesafe-request-id') === null) {
        metrics.errorClassMismatches += 1;
      }

      const tooMany = Object.fromEntries(
        Array.from({ length: 256 }, (_, i) => [`o${String(i)}`, null]),
      );
      const invalid = await expectError(
        client(url).systemOne({ ...request(), questions: { target: choice('Pick one', tooMany) } }),
        UnprocessableEntityError,
        422,
      );
      expect(JSON.stringify(invalid.body)).toMatch(/at most 255 options/);
      const maxOptions = Object.fromEntries(
        Array.from({ length: 255 }, (_, i) => [`o${String(i)}`, null]),
      );
      const accepted = await client(url).systemOne({
        ...request(),
        questions: { wide: choice('Pick one', maxOptions) },
      });
      expect(accepted.answers.wide.choice).toBe('o254');
      expect(Object.keys(accepted.answers.wide.probabilities)).toHaveLength(255);

      await expectError(
        client(url).systemOne({
          ...request(),
          questions: {
            severity: score('Rate', [
              '0',
              '1',
              '2',
              '3',
              '4',
              '5',
              '6',
              '7',
              '8',
              '9',
              '10',
            ] as const),
          },
        }),
        UnprocessableEntityError,
        422,
      );
      await expectError(
        client(url).systemOne({ ...request(), model: 'jev-0.0.1' }),
        UnprocessableEntityError,
        422,
      );
      const { state: _state, ...withoutState } = request();
      await expectError(
        client(url).systemOne(withoutState as unknown as SystemOneRequest),
        UnprocessableEntityError,
        422,
      );
      await expectError(
        client(url).systemOne({
          ...request(),
          questions: {
            odd: { type: 'ranking', criteria: {} } as unknown as ReturnType<typeof noul>,
          },
        }),
        UnprocessableEntityError,
        422,
      );

      server.enqueue({ status: 429, retryAfterMs: 1500 });
      const limited = await expectError(client(url).systemOne(request()), RateLimitError, 429);
      expect((limited as RateLimitError).retryAfterMs).toBe(1500);
      expect(limited.headers.get('retry-after')).toBe('2');

      server.enqueue({ status: 529 });
      const overloaded = await expectError(
        client(url).systemOne(request()),
        InternalServerError,
        529,
      );
      expect(overloaded.message).toMatch(/Overloaded/);

      for (const record of server.requests) {
        expect(record.requestId).toMatch(/^req_\d{4}$/);
        expect(record.headers.authorization ?? '').not.toContain(DEFAULT_FAKE_JEV_API_KEY);
      }
    } finally {
      await server.close();
    }
  });
});
