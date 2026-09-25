/**
 * `LlmAnalyst`, the `Analyst` port over an `LlmProvider` (implementation spec M07). Every
 * operation builds its request under a token budget, asks once, validates the answer,
 * and on an invalid answer asks exactly once more with the validator errors; a second
 * invalid answer is `invalid_answer`, which the engine records as `ANALYST_INVALID`.
 */
import {
  err,
  ok,
  validate,
  type Analyst,
  type AnalystDecision,
  type AnalystError,
  type Billed,
  type BreakPacket,
  type BrainUsage,
  type BreakReason,
  type ReportBody,
  type ReportInput,
  type Result,
  type TriageFrames,
  type UsageOperation,
  type VisionAssertRequest,
  type VisionAssertResult,
  type VisualGroundRequest,
  type VisualGroundResult,
} from '@argus/contracts';
import type { ImageScaler, ScaledImage } from '../ports/images.js';
import type { LlmError, LlmProvider, LlmRequest, LlmResponse } from '../ports/llm.js';
import { readJsonAnswer } from './answer.js';
import { DEFAULT_LIMITS, type AnalystLimits } from './budgets.js';
import { dataBlock } from './data-block.js';
import { selectFrames } from './frames.js';
import {
  renderSection,
  selectTemplate,
  type PromptKind,
  type PromptTemplate,
} from './prompt-template.js';
import { visionAssertAnswerSchema, visualGroundAnswerSchema } from './provider-schema.js';
import { assembleReportBody, readReportDraft } from './report.js';
import { buildReportRequest, type ReportKeyFrame } from './report-request.js';
import {
  estimateLlmRequest,
  sizesOf,
  toRequest,
  userMessage,
  type ImageSizes,
  type LabelledImage,
} from './request.js';
import { buildTriageRequest, type TriageFrame } from './triage-request.js';
import { formatIssue, validateDecision } from './validate-decision.js';

export type AnalystOperation = 'triage' | 'ground-visual' | 'assert-visual' | 'report';

/** What was sent, for logs, metrics and budget audits. */
export interface AnalystRequestInfo {
  readonly operation: AnalystOperation;
  /** 1 for the first request, 2 for the repair. */
  readonly attempt: 1 | 2;
  readonly promptVersion: string;
  readonly estimatedTokens: number;
  readonly budget: number;
  readonly images: number;
  readonly omitted: unknown;
  readonly request: LlmRequest;
}

export interface LlmAnalystOptions {
  readonly provider: LlmProvider;
  readonly scaler: ImageScaler;
  readonly prompts: readonly PromptTemplate[];
  /** Model id of the tier this Analyst serves (`modelForTier`). */
  readonly model: string;
  /** Pinned prompt ids; the highest version of each kind otherwise. */
  readonly promptVersions?: Partial<Record<PromptKind, string>>;
  readonly limits?: Partial<AnalystLimits>;
  readonly temperature?: number;
  readonly onRequest?: (info: AnalystRequestInfo) => void;
}

/** The break reason an Analyst failure becomes in the engine. */
export function analystBreakReason(error: AnalystError): BreakReason {
  return error.code === 'invalid_answer' ? 'ANALYST_INVALID' : 'ANALYST_UNAVAILABLE';
}

function fromLlmError(error: LlmError): AnalystError {
  return error.code === 'unavailable'
    ? { code: 'unavailable', message: error.message }
    : { code: 'invalid_request', message: `the provider rejected the request: ${error.message}` };
}

function schemaErrors(errors: readonly { path: string; message: string }[]): string[] {
  return errors.map((error) => `${error.path || '/'}: ${error.message}`);
}

const MAX_REPAIR_ERRORS = 12;
const MAX_REPAIR_ERROR_CHARS = 300;

interface Ask<T> {
  readonly operation: AnalystOperation;
  readonly template: PromptTemplate;
  readonly request: LlmRequest;
  readonly sizes: ImageSizes;
  readonly budget: number;
  readonly estimatedTokens: number;
  readonly omitted: unknown;
  readonly billable: UsageOperation;
  readonly check: (value: unknown, response: LlmResponse) => Result<T, string[]>;
}

export class LlmAnalyst implements Analyst {
  readonly limits: AnalystLimits;
  readonly #options: LlmAnalystOptions;
  readonly #templates: Readonly<Record<PromptKind, PromptTemplate>>;

  private constructor(options: LlmAnalystOptions, templates: Record<PromptKind, PromptTemplate>) {
    this.#options = options;
    this.#templates = templates;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
  }

  /** An Analyst, or the reasons the prompts cannot serve it. */
  static create(options: LlmAnalystOptions): Result<LlmAnalyst, string[]> {
    const errors: string[] = [];
    const templates: Partial<Record<PromptKind, PromptTemplate>> = {};
    for (const kind of ['triage', 'report', 'vision'] as const) {
      const selected = selectTemplate(options.prompts, kind, options.promptVersions?.[kind]);
      if (selected.ok) templates[kind] = selected.value;
      else errors.push(selected.error);
    }
    if (options.model.trim() === '') errors.push('the model id is empty');
    const { triage, report, vision } = templates;
    if (errors.length > 0 || triage === undefined || report === undefined || vision === undefined) {
      return err(errors);
    }
    return ok(new LlmAnalyst(options, { triage, report, vision }));
  }

  /** The prompt id each operation uses. */
  get promptVersions(): Readonly<Record<PromptKind, string>> {
    return {
      triage: this.#templates.triage.id,
      report: this.#templates.report.id,
      vision: this.#templates.vision.id,
    };
  }

  async triage(
    packet: BreakPacket,
    frames?: TriageFrames,
  ): Promise<Result<Billed<AnalystDecision>, AnalystError>> {
    const checked = validate('BreakPacket', packet);
    if (!checked.ok) {
      return err({
        code: 'invalid_request',
        message: `invalid break packet: ${schemaErrors(checked.error).join('; ')}`,
      });
    }
    const images = new Map((frames?.frameImages ?? []).map((frame) => [frame.ref, frame.image]));
    const selected = selectFrames(
      packet.frames,
      (ref) => images.has(ref),
      this.limits.triageMaxFrames,
    );
    const scaled: TriageFrame[] = [];
    for (const frame of selected) {
      const image = images.get(frame.ref);
      if (image === undefined) continue;
      const fitted = await this.#options.scaler.fit(image, this.limits.maxLongEdge);
      // A frame that does not decode is left out; the packet still lists it.
      if (fitted.ok) scaled.push({ frame, scaled: fitted.value });
    }
    const template = this.#templates.triage;
    const built = buildTriageRequest(packet, scaled, {
      model: this.#options.model,
      template,
      limits: this.limits,
      temperature: this.#options.temperature,
    });
    if (!built.ok) {
      return err({ code: 'invalid_request', message: built.error });
    }
    return this.#ask({
      operation: 'triage',
      template,
      request: built.value.request,
      sizes: sizesOf(scaled.map((frame) => frame.scaled)),
      budget: this.limits.triageTokenBudget,
      estimatedTokens: built.value.estimatedTokens,
      omitted: built.value.omitted,
      billable: 'escalation',
      check: (value) => {
        const decision = validateDecision(packet, value);
        return decision.ok ? ok(decision.value) : err(decision.error.map(formatIssue));
      },
    });
  }

  async groundVisually(
    request: VisualGroundRequest,
  ): Promise<Result<Billed<VisualGroundResult>, AnalystError>> {
    const checked = validate('VisualGroundRequest', request);
    if (!checked.ok) {
      return err({
        code: 'invalid_request',
        message: `invalid visual grounding request: ${schemaErrors(checked.error).join('; ')}`,
      });
    }
    const fitted = await this.#options.scaler.fit(request.image, this.limits.maxLongEdge);
    if (!fitted.ok) {
      return err({
        code: 'invalid_request',
        message: `the screenshot does not decode: ${fitted.error.message}`,
      });
    }
    const template = this.#templates.vision;
    const marks = request.marks.map((mark) => mark.mark);
    const build = (withLabels: boolean): LlmRequest =>
      toRequest({
        model: this.#options.model,
        system: renderSection(template, 'system:ground', {}),
        messages: [
          userMessage(
            renderSection(template, 'user:ground', {
              'data:step': dataBlock('step', { stepId: request.stepId, ...request.step }),
              'data:marks': dataBlock(
                'marks',
                request.marks.map((mark) => (withLabels ? mark : { mark: mark.mark })),
              ),
            }),
            [{ label: { image: 'set-of-marks screenshot' }, scaled: fitted.value }],
          ),
        ],
        jsonSchema: { name: 'visual_ground', schema: visualGroundAnswerSchema(request) },
        maxTokens: this.limits.visionMaxOutputTokens,
        timeoutMs: this.limits.visionTimeoutMs,
        temperature: this.#options.temperature,
      });
    const sizes = sizesOf([fitted.value]);
    const budget = this.limits.visionTokenBudget;
    let built = build(true);
    let omitted = { markLabels: false };
    if (estimateLlmRequest(built, sizes) > budget - this.limits.repairReserveTokens) {
      built = build(false);
      omitted = { markLabels: true };
    }
    const estimated = estimateLlmRequest(built, sizes);
    if (estimated > budget - this.limits.repairReserveTokens) {
      return err({
        code: 'invalid_request',
        message: `the visual grounding request needs about ${String(estimated)} tokens; the budget is ${String(budget - this.limits.repairReserveTokens)}`,
      });
    }
    return this.#ask({
      operation: 'ground-visual',
      template,
      request: built,
      sizes,
      budget,
      estimatedTokens: estimated,
      omitted,
      billable: 'ai_vision',
      check: (value) => {
        const result = validate('VisualGroundResult', value);
        if (!result.ok) return err(schemaErrors(result.error));
        const mark = result.value.mark;
        if (mark !== null && !marks.includes(mark)) {
          return err([
            `/mark: ${mark} is not one of the marks ${marks.join(', ')}; answer one of them or null`,
          ]);
        }
        return ok(result.value);
      },
    });
  }

  async assertVisually(
    request: VisionAssertRequest,
  ): Promise<Result<Billed<VisionAssertResult>, AnalystError>> {
    const checked = validate('VisionAssertRequest', request);
    if (!checked.ok) {
      return err({
        code: 'invalid_request',
        message: `invalid vision assertion request: ${schemaErrors(checked.error).join('; ')}`,
      });
    }
    const main = await this.#options.scaler.fit(request.image, this.limits.maxLongEdge);
    if (!main.ok) {
      return err({
        code: 'invalid_request',
        message: `the screenshot does not decode: ${main.error.message}`,
      });
    }
    const frames: ScaledImage[] = [];
    for (const frame of (request.frames ?? []).slice(0, this.limits.triageMaxFrames)) {
      const fitted = await this.#options.scaler.fit(frame, this.limits.maxLongEdge);
      if (fitted.ok) frames.push(fitted.value);
    }
    const template = this.#templates.vision;
    const sizes = sizesOf([main.value, ...frames]);
    const budget = this.limits.visionTokenBudget;
    // The expected answer is not sent: the model answers the question, code compares.
    const build = (frameCount: number): LlmRequest => {
      const images: LabelledImage[] = [
        { label: { image: 'screenshot after the step' }, scaled: main.value },
        ...frames.slice(0, frameCount).map((scaled, index) => ({
          label: { image: 'frame', index },
          scaled,
        })),
      ];
      return toRequest({
        model: this.#options.model,
        system: renderSection(template, 'system:assert', {}),
        messages: [
          userMessage(
            renderSection(template, 'user:assert', {
              'data:question': dataBlock('question', {
                stepId: request.stepId,
                question: request.question,
              }),
            }),
            images,
          ),
        ],
        jsonSchema: { name: 'vision_assert', schema: visionAssertAnswerSchema() },
        maxTokens: this.limits.visionMaxOutputTokens,
        timeoutMs: this.limits.visionTimeoutMs,
        temperature: this.#options.temperature,
      });
    };
    let count = frames.length;
    let built = build(count);
    while (
      count > 0 &&
      estimateLlmRequest(built, sizes) > budget - this.limits.repairReserveTokens
    ) {
      count--;
      built = build(count);
    }
    const estimated = estimateLlmRequest(built, sizes);
    if (estimated > budget - this.limits.repairReserveTokens) {
      return err({
        code: 'invalid_request',
        message: `the vision assertion request needs about ${String(estimated)} tokens; the budget is ${String(budget - this.limits.repairReserveTokens)}`,
      });
    }
    return this.#ask({
      operation: 'assert-visual',
      template,
      request: built,
      sizes,
      budget,
      estimatedTokens: estimated,
      omitted: { frames: frames.length - count },
      billable: 'ai_vision',
      check: (value) => {
        const result = validate('VisionAssertResult', value);
        return result.ok ? ok(result.value) : err(schemaErrors(result.error));
      },
    });
  }

  async report(input: ReportInput): Promise<Result<Billed<ReportBody>, AnalystError>> {
    const checked = validate('ReportInput', input);
    if (!checked.ok) {
      return err({
        code: 'invalid_request',
        message: `invalid report input: ${schemaErrors(checked.error).join('; ')}`,
      });
    }
    let template = this.#templates.report;
    if (input.promptVersion !== undefined) {
      const pinned = selectTemplate(this.#options.prompts, 'report', input.promptVersion);
      if (!pinned.ok) return err({ code: 'invalid_request', message: pinned.error });
      template = pinned.value;
    }
    const keyFrames: ReportKeyFrame[] = [];
    for (const frame of input.keyFrames) {
      if (keyFrames.length >= this.limits.reportMaxKeyFrames) break;
      if (frame.image === undefined) continue;
      const fitted = await this.#options.scaler.fit(frame.image, this.limits.maxLongEdge);
      if (fitted.ok) keyFrames.push({ ref: frame.ref, stepId: frame.stepId, scaled: fitted.value });
    }
    const built = buildReportRequest(input, keyFrames, {
      model: this.#options.model,
      template,
      limits: this.limits,
      temperature: this.#options.temperature,
    });
    if (!built.ok) {
      return err({ code: 'invalid_request', message: built.error });
    }
    return this.#ask({
      operation: 'report',
      template,
      request: built.value.request,
      sizes: sizesOf(keyFrames.map((frame) => frame.scaled)),
      budget: this.limits.reportTokenBudget,
      estimatedTokens: built.value.estimatedTokens,
      omitted: built.value.omitted,
      billable: 'report',
      check: (value, response) => {
        const draft = readReportDraft(value);
        if (!draft.ok) return draft;
        return assembleReportBody(draft.value, input, {
          model: response.model.slice(0, 128) || this.#options.model,
          promptVersion: template.id,
        });
      },
    });
  }

  async #ask<T>(ask: Ask<T>): Promise<Result<Billed<T>, AnalystError>> {
    const images = (request: LlmRequest): number =>
      request.messages.reduce(
        (total, message) => total + message.content.filter((part) => part.type === 'image').length,
        0,
      );
    this.#options.onRequest?.({
      operation: ask.operation,
      attempt: 1,
      promptVersion: ask.template.id,
      estimatedTokens: ask.estimatedTokens,
      budget: ask.budget,
      images: images(ask.request),
      omitted: ask.omitted,
      request: ask.request,
    });
    const first = await this.#options.provider.complete(ask.request);
    if (!first.ok) {
      return err(fromLlmError(first.error));
    }
    const firstAnswer = this.#read(ask, first.value);
    if (firstAnswer.ok) {
      return ok({ result: firstAnswer.value, usage: this.#usage(ask.billable, [first.value]) });
    }
    const previous =
      first.value.text !== '' ? first.value.text : JSON.stringify(first.value.json ?? null);
    const quoted =
      previous.length <= this.limits.repairAnswerChars
        ? previous
        : `${previous.slice(0, this.limits.repairAnswerChars)} [${String(previous.length - this.limits.repairAnswerChars)} more characters not shown]`;
    const errors = firstAnswer.error
      .slice(0, MAX_REPAIR_ERRORS)
      .map((error) =>
        error.length <= MAX_REPAIR_ERROR_CHARS
          ? error
          : `${error.slice(0, MAX_REPAIR_ERROR_CHARS)}…`,
      );
    if (firstAnswer.error.length > MAX_REPAIR_ERRORS) {
      errors.push(
        `${String(firstAnswer.error.length - MAX_REPAIR_ERRORS)} further errors not shown`,
      );
    }
    const repairText = renderSection(ask.template, 'repair', {
      'data:previous': dataBlock('previous', { answer: quoted }),
      'data:errors': dataBlock('errors', errors),
    });
    const repair: LlmRequest = {
      ...ask.request,
      messages: [
        ...ask.request.messages,
        { role: 'user', content: [{ type: 'text', text: repairText }] },
      ],
    };
    const repairTokens = estimateLlmRequest(repair, ask.sizes);
    if (repairTokens > ask.budget) {
      return err({
        code: 'invalid_answer',
        message: `the answer was invalid and the repair request (about ${String(repairTokens)} tokens) exceeds the budget of ${String(ask.budget)}`,
        errors: firstAnswer.error,
      });
    }
    this.#options.onRequest?.({
      operation: ask.operation,
      attempt: 2,
      promptVersion: ask.template.id,
      estimatedTokens: repairTokens,
      budget: ask.budget,
      images: images(repair),
      omitted: ask.omitted,
      request: repair,
    });
    const second = await this.#options.provider.complete(repair);
    if (!second.ok) {
      return err(fromLlmError(second.error));
    }
    const secondAnswer = this.#read(ask, second.value);
    if (secondAnswer.ok) {
      return ok({
        result: secondAnswer.value,
        usage: this.#usage(ask.billable, [first.value, second.value]),
      });
    }
    return err({
      code: 'invalid_answer',
      message: `the ${ask.operation} answer stayed invalid after one repair attempt`,
      errors: secondAnswer.error,
    });
  }

  #read<T>(ask: Ask<T>, response: LlmResponse): Result<T, string[]> {
    const json = readJsonAnswer(response);
    return json.ok ? ask.check(json.value, response) : json;
  }

  #usage(operation: UsageOperation, responses: readonly LlmResponse[]): BrainUsage {
    const last = responses[responses.length - 1];
    return {
      provider: 'llm',
      model: (last?.model ?? '').slice(0, 128) || this.#options.model,
      calls: responses.length,
      inputTokens: responses.reduce((total, response) => total + response.usage.inputTokens, 0),
      outputTokens: responses.reduce((total, response) => total + response.usage.outputTokens, 0),
      billable: { operation, quantity: 1 },
    };
  }
}
