/** Shared fixtures of the Analyst tests: packets, images, fake LLM wiring. */
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  allowedDecisions,
  AnthropicProvider,
  LlmAnalyst,
  loadPromptDirectory,
  OpenAiCompatibleProvider,
  SharpImageScaler,
  type AnalystRequestInfo,
  type LlmAnalystOptions,
  type LlmProvider,
  type PromptTemplate,
  type RetryPolicy,
} from '../src/index.js';
import { DEFAULT_FAKE_LLM_API_KEY, type FakeLlmServer, type LlmShape } from '@argus/testkit';
import {
  contentHash,
  resolvePolicy,
  type ReportInput,
  type RunEvent,
  type RunStats,
} from '@argus/contracts';
import type {
  AnalystDecision,
  BreakPacket,
  BreakReason,
  Clock,
  InlineImage,
} from '@argus/contracts';

export const PROMPTS_DIR = fileURLToPath(new URL('../../../prompts', import.meta.url));

let prompts: PromptTemplate[] | undefined;

export async function repositoryPrompts(): Promise<PromptTemplate[]> {
  if (prompts === undefined) {
    const loaded = await loadPromptDirectory(PROMPTS_DIR);
    if (!loaded.ok) throw new Error(loaded.error.join('\n'));
    prompts = loaded.value;
  }
  return prompts;
}

/** A solid-colour image with a stripe whose position depends on `seed`. */
export async function image(
  width: number,
  height: number,
  seed = 0,
  mediaType: InlineImage['mediaType'] = 'image/png',
): Promise<InlineImage> {
  const stripe = await sharp({
    create: {
      width: Math.max(1, Math.floor(width / 8)),
      height,
      channels: 3,
      background: { r: 200, g: 30, b: 30 },
    },
  })
    .png()
    .toBuffer();
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 40 + (seed % 200), g: 90, b: 160 } },
  }).composite([
    { input: stripe, left: (seed * 37) % Math.max(1, width - Math.floor(width / 8)), top: 0 },
  ]);
  const encoded =
    mediaType === 'image/png' ? base.png() : mediaType === 'image/webp' ? base.webp() : base.jpeg();
  return { mediaType, data: (await encoded.toBuffer()).toString('base64') };
}

export const ORIGIN = 'https://hmi.test';

export const FRAME_REFS = [-5000, -3000, -2000, -1000, -500, 0, 800, 2000].map((tMs, index) => ({
  ref: `art://runs/r1/ring/f${String(400 + index)}.jpg`,
  tMs,
}));

/** A packet like the spec example; `reason`, strictness and criticality set the menu. */
export function packet(
  options: {
    reason?: BreakReason;
    strict?: boolean;
    critical?: boolean;
    patchActions?: BreakPacket['allowed']['patchActions'];
    origins?: string[];
    patchActionsMax?: number;
  } = {},
): BreakPacket {
  const reason = options.reason ?? 'EXPECTATION_UNCERTAIN';
  const critical = options.critical ?? false;
  return {
    runId: 'run_01J8',
    stepId: 's5',
    attempt: 1,
    reason,
    script: {
      title: 'Start C12 and handle a jam',
      stepIndex: 4,
      stepCount: 7,
      step: {
        id: 's5',
        intent: 'Check the jam alarm appears and blinks',
        action: 'assert',
        risk: critical ? 'critical' : 'read',
        target: { description: 'Jam alarm row of conveyor C12' },
      },
      previousIntents: ['Start conveyor C12', 'Trigger a jam on C12 through the simulator'],
      nextIntent: 'Acknowledge the alarm',
    },
    signals: {
      jev: { expect_0: 0.46, probe_error_ui: 0.08 },
      checks: [
        { kind: 'blink', outcome: 'fail', detail: '0.0 Hz over 6 s' },
        { kind: 'dom', outcome: 'pass', detail: 'alarm row exists' },
      ],
      actionError: null,
      elapsedMs: 15012,
    },
    observations: {
      before: {
        digestHash: `sha256:${'5d1e'.repeat(16)}`,
        url: 'https://hmi.test/overview',
        title: 'Conveyor overview',
        page: {
          headings: ['Conveyor overview', 'Alarms'],
          dialogs: [],
          alerts: ['Communication OK'],
          loading: { inflightRequests: 0, spinners: 0 },
          textDigest: 'Conveyor overview | C11 Stopped | C12 Running | Alarms: none',
        },
      },
      after: {
        digestHash: `sha256:${'77aa'.repeat(16)}`,
        url: 'https://hmi.test/overview',
        title: 'Conveyor overview',
        page: {
          headings: ['Conveyor overview', 'Alarms'],
          dialogs: [],
          alerts: ['Jam on C12'],
          loading: { inflightRequests: 0, spinners: 0 },
          textDigest:
            'Conveyor overview | C11 Stopped | C12 Jammed | Alarms: Jam C12 unacknowledged',
        },
      },
    },
    frames: FRAME_REFS.slice(0, 6),
    console: [{ level: 'warning', text: 'Slow render of alarm table' }],
    network: [{ method: 'GET', url: 'https://hmi.test/api/alarms', status: 200 }],
    candidates: [
      {
        cid: 'c17',
        role: 'row',
        name: 'Jam C12',
        row: 'C12 | Jam | unacknowledged',
        region: 'Alarms',
        probability: 0.48,
      },
      {
        cid: 'c18',
        role: 'row',
        name: 'Jam C12',
        row: 'C12 | Jam | acknowledged',
        region: 'Alarm history',
        probability: 0.45,
      },
    ],
    allowed: {
      decisions: allowedDecisions(reason, { strict: options.strict ?? false }, { critical }),
      patchActions: options.patchActions ?? [
        'click',
        'press',
        'scroll',
        'hover',
        'wait',
        'navigate',
      ],
      origins: options.origins ?? [ORIGIN],
    },
    budget: { escalationsLeft: 4, patchActionsMax: options.patchActionsMax ?? 3 },
  };
}

/** A valid decision for `packet()` with the default reason. */
export function decision(overrides: Partial<AnalystDecision> = {}): AnalystDecision {
  return {
    decision: 'MARK_FAILED_CONTINUE',
    classification: 'PRODUCT_DEFECT',
    certainty: 'high',
    rationale: 'The jam alarm row for C12 is present in all six frames but never blinks.',
    evidence: [{ frame: 'art://runs/r1/ring/f403.jpg', note: 'Alarm row static at t-1 s' }],
    patch: [],
    defect: {
      title: 'Unacknowledged jam alarm does not blink',
      severity: 'major',
      expected: 'Alarm row blinks until acknowledged',
      actual: 'Alarm row is static',
    },
    scriptSuggestion: null,
    ...overrides,
  };
}

/** A clock whose sleeps return at once and move virtual time forward. */
export class InstantClock implements Clock {
  #now = 1_000_000;
  readonly sleeps: number[] = [];
  now(): number {
    return this.#now;
  }
  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.#now += ms;
    return Promise.resolve();
  }
}

export const FAST_RETRY: Partial<RetryPolicy> = { baseDelayMs: 1, maxDelayMs: 5 };

export function providerFor(
  shape: LlmShape,
  llm: FakeLlmServer,
  options: { retry?: Partial<RetryPolicy>; clock?: Clock } = {},
): LlmProvider {
  const retry = options.retry ?? FAST_RETRY;
  return shape === 'anthropic'
    ? new AnthropicProvider({
        apiKey: DEFAULT_FAKE_LLM_API_KEY,
        baseURL: llm.url,
        refusalFallback: false,
        retry,
        ...(options.clock === undefined ? {} : { clock: options.clock }),
      })
    : new OpenAiCompatibleProvider({
        baseURL: `${llm.url}/v1`,
        apiKey: DEFAULT_FAKE_LLM_API_KEY,
        retry,
        ...(options.clock === undefined ? {} : { clock: options.clock }),
      });
}

export async function analystFor(
  provider: LlmProvider,
  options: Partial<LlmAnalystOptions> & { requests?: AnalystRequestInfo[] } = {},
): Promise<LlmAnalyst> {
  const { requests, ...rest } = options;
  const created = LlmAnalyst.create({
    provider,
    scaler: new SharpImageScaler(),
    prompts: await repositoryPrompts(),
    model: 'fake-llm',
    ...(requests === undefined ? {} : { onRequest: (info) => requests.push(info) }),
    ...rest,
  });
  if (!created.ok) throw new Error(created.error.join('\n'));
  return created.value;
}

/** Frame images for every frame of a packet. */
export async function frameImages(
  refs: readonly { ref: string }[],
  width = 1920,
  height = 1080,
): Promise<{ ref: string; image: InlineImage }[]> {
  return Promise.all(
    refs.map(async (frame, index) => ({
      ref: frame.ref,
      image: await image(width, height, index, 'image/jpeg'),
    })),
  );
}

export const SHAPES: readonly LlmShape[] = ['anthropic', 'openai'];

// ---------------------------------------------------------------------------
// Report fixtures
// ---------------------------------------------------------------------------

type EventBody = { type: RunEvent['type']; stepId?: string; data: unknown };

/** A gapless, hash-chained ledger from event bodies. */
export function ledger(bodies: readonly EventBody[], runId = 'run_01J8'): RunEvent[] {
  const events: RunEvent[] = [];
  let prev: string | null = null;
  bodies.forEach((body, index) => {
    const event = {
      runId,
      seq: index + 1,
      ts: new Date(Date.UTC(2026, 8, 21, 10, 0, 0) + index * 250).toISOString(),
      type: body.type,
      ...(body.stepId === undefined ? {} : { stepId: body.stepId }),
      data: body.data,
      prev,
    } as unknown as RunEvent;
    events.push(event);
    prev = contentHash(event);
  });
  return events;
}

export const STATS: RunStats = {
  steps: 3,
  passed: 2,
  failed: 1,
  broken: 0,
  skipped: 0,
  durationMs: 74211,
  jevCalls: 13,
  llmCalls: 2,
  credits: 31,
};

const POLICY = resolvePolicy({
  strict: false,
  onBreak: 'escalate',
  failOnConsoleError: false,
  shareScreenshotsWithLlm: 'on-break',
  artifacts: 'on-failure',
});

export function runStarted(): EventBody {
  return {
    type: 'run.started',
    data: {
      runnerId: 'rnr_1',
      scriptHash: `sha256:${'ab'.repeat(32)}`,
      environment: { name: 'staging', kind: 'staging', baseUrl: ORIGIN },
      policy: POLICY,
      versions: {
        engine: '0.1.0',
        questions: '0.1.0',
        thresholds: '0.1.0',
        models: { navigator: 'jev-1.13.0', analyst: 'fake-llm' },
      },
    },
  };
}

export function stepEvents(
  stepId: string,
  index: number,
  outcome: 'passed' | 'failed',
  extra: EventBody[] = [],
): EventBody[] {
  return [
    { type: 'step.started', stepId, data: { attempt: 1, index } },
    ...extra,
    {
      type: 'step.finished',
      stepId,
      data: {
        attempt: 1,
        outcome,
        durationMs: 2100,
        reason: outcome === 'failed' ? 'EXPECTATION_FAILED' : null,
        ...(outcome === 'failed' ? { classification: 'PRODUCT_DEFECT' } : {}),
      },
    },
  ];
}

export function runFinished(): EventBody {
  return {
    type: 'run.finished',
    data: {
      termination: 'completed',
      reason: null,
      counters: {
        steps: STATS.steps,
        passed: STATS.passed,
        failed: STATS.failed,
        broken: STATS.broken,
        skipped: STATS.skipped,
        escalations: 1,
        handlerFirings: 0,
        jevCalls: STATS.jevCalls,
        llmCalls: STATS.llmCalls,
        durationMs: STATS.durationMs,
      },
    },
  };
}

/** A three-step run whose second step failed after an escalation. */
export function reportInput(extraBodies: EventBody[] = []): ReportInput {
  const escalation: EventBody[] = [
    {
      type: 'escalation.requested',
      stepId: 's2',
      data: {
        packetRef: 'art://runs/r1/packets/s2.json',
        reason: 'EXPECTATION_FAILED',
        attempt: 1,
      },
    },
    {
      type: 'escalation.decided',
      stepId: 's2',
      data: {
        decision: 'MARK_FAILED_CONTINUE',
        classification: 'PRODUCT_DEFECT',
        valid: true,
        errors: [],
        repaired: false,
        inputTokens: 9000,
        outputTokens: 400,
      },
    },
  ];
  return {
    runId: 'run_01J8',
    script: {
      name: 'conveyor-start-and-jam',
      title: 'Start C12 and handle a jam',
      steps: [
        { id: 's1', intent: 'Start conveyor C12' },
        { id: 's2', intent: 'Check the jam alarm appears and blinks' },
        { id: 's3', intent: 'Acknowledge the alarm' },
      ],
    },
    verdict: 'failed',
    flags: { adjudicated: false, healed: false },
    stats: STATS,
    events: ledger([
      runStarted(),
      ...stepEvents('s1', 0, 'passed'),
      ...stepEvents('s2', 1, 'failed', escalation),
      ...stepEvents('s3', 2, 'passed'),
      ...extraBodies,
      runFinished(),
    ]),
    keyFrames: [],
  };
}

/** A draft the model could write for `reportInput()`. */
export function draft(): Record<string, unknown> {
  return {
    summary:
      'Three steps ran. Conveyor C12 started, but the jam alarm appeared without blinking, so step s2 failed.',
    defects: [
      {
        stepId: 's2',
        title: 'Unacknowledged jam alarm does not blink',
        severity: 'major',
        classification: 'PRODUCT_DEFECT',
      },
    ],
    adjudications: [],
    maintenance: [],
  };
}
