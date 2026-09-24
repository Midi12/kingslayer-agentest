/**
 * M03-G4: error injection works. A scripted 429, then 529, then 200: the fake's call log
 * shows three attempts and the SDK, with its default retry policy, returns the final
 * answer. The 429 carries Retry-After and retry-after-ms, and the SDK waits for it.
 */
import { TypeSafeClient, choice, noul } from '@typesafe-ai/sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_FAKE_JEV_API_KEY, startFakeJev } from '../src/index.js';
import { recordGateMetrics } from '../src/gate-metrics.js';

const RETRY_AFTER_MS = 300;

const metrics = {
  attempts: 0,
  statuses: '',
  sdkAnswered: false,
  retryHeaders: '',
  retryAfterHonoured: false,
};

afterAll(() => {
  recordGateMetrics({ ...metrics });
});

describe('M03-G4 scripted 429, 529, then 200', () => {
  it('the SDK retries twice and returns the answer of the third attempt', async () => {
    const server = await startFakeJev({
      mode: {
        kind: 'scripted',
        script: {
          answers: { target: { choice: 'c17', confidence: 0.8 }, target_present: 0.9 },
          outcomes: [{ status: 429, retryAfterMs: RETRY_AFTER_MS }, { status: 529 }],
        },
      },
    });
    try {
      // Default retry policy: two retries on 408, 429 and 5xx, honouring retry-after.
      const sdk = new TypeSafeClient({
        apiKey: DEFAULT_FAKE_JEV_API_KEY,
        baseURL: server.url,
        logLevel: 'off',
      });
      const result = await sdk.systemOne({
        model: 'jev-1.13.0',
        state: { step: { target: 'Start button in the row of conveyor C12' } },
        questions: {
          target: choice('Which option is the element described by `step.target`?', {
            c16: 'Start C11',
            c17: 'Start C12',
          }),
          target_present: noul('Does the page contain the element described by `step.target`?'),
        },
      });
      metrics.sdkAnswered =
        result.answers.target.choice === 'c17' && result.answers.target_present.noul === 0.9;
      metrics.attempts = server.requests.length;
      metrics.statuses = server.requests.map((request) => request.status).join(',');
      metrics.retryHeaders = server.requests.map((request) => request.retryCount).join(',');
      const [first, second] = server.requests;
      metrics.retryAfterHonoured =
        first !== undefined &&
        second !== undefined &&
        second.receivedAt - first.receivedAt >= RETRY_AFTER_MS;

      expect(metrics.sdkAnswered).toBe(true);
      expect(metrics.attempts).toBe(3);
      expect(metrics.statuses).toBe('429,529,200');
      expect(metrics.retryHeaders).toBe('0,1,2');
      expect(server.requests.map((request) => request.outcome)).toEqual([
        'injected-error',
        'injected-error',
        'answered',
      ]);
      expect(metrics.retryAfterHonoured).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('per-request matchers keep their own queue, and delays hold the answer', async () => {
    const server = await startFakeJev({
      mode: {
        kind: 'scripted',
        script: {
          answers: { probe: false },
          rules: [
            {
              match: { stateIncludes: 'flaky page' },
              outcomes: [{ status: 429, retryAfterMs: 0 }],
            },
          ],
          outcomes: [{ delayMs: 150 }],
        },
      },
    });
    try {
      const sdk = new TypeSafeClient({
        apiKey: DEFAULT_FAKE_JEV_API_KEY,
        baseURL: server.url,
        logLevel: 'off',
      });
      const started = Date.now();
      const slow = await sdk.systemOne({
        state: 'calm page',
        questions: { probe: noul('Is there an error?') },
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(140);
      expect(slow.answers.probe.noul).toBe(0);
      const flaky = await sdk.systemOne({
        state: 'flaky page',
        questions: { probe: noul('Is there an error?') },
      });
      expect(flaky.answers.probe.noul).toBe(0);
      expect(server.requests.map((request) => request.status)).toEqual([200, 429, 200]);
    } finally {
      await server.close();
    }
  });
});
