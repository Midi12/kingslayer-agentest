import { describe, expect, it } from 'vitest';
import {
  JEV_MODELS,
  MAX_CONTEXT_TOKENS,
  ScriptRunner,
  answerFromScript,
  argmax,
  choiceAnswer,
  choiceConfidence,
  distributionWithConfidence,
  lookupAnswer,
  normalize,
  oracleAnswers,
  oracleFromTargets,
  scoreAnswer,
  seededRandom,
  validateJevRequest,
  type JevQuestion,
  type JevRequest,
} from '../src/index.js';

const models = {
  models: JEV_MODELS.map((model) => model.name),
  aliases: { 'jev-latest': 'jev-1.13.0' },
};
const noul: JevQuestion = { type: 'noul' };
const pick: JevQuestion = { type: 'choice', criteria: { a: 'A', b: 'B', c: null } };
const rate: JevQuestion = { type: 'score', criteria: ['low', 'mid', 'high'] };

function request(
  questions: Record<string, JevQuestion>,
  state: JevRequest['state'] = 'page',
): JevRequest {
  return { model: 'jev-1.13.0', state, questions };
}

describe('answers', () => {
  it('computes confidence as (n·p_max − 1)/(n − 1)', () => {
    expect(choiceConfidence([1])).toBe(1);
    expect(choiceConfidence([0.5, 0.5])).toBe(0);
    expect(choiceConfidence([0.7, 0.2, 0.1])).toBeCloseTo(0.55, 12);
    expect(choiceConfidence([])).toBe(1);
  });

  it('normalises weights and picks the first maximum', () => {
    expect(normalize([])).toEqual([]);
    expect(normalize([0, 0])).toEqual([0.5, 0.5]);
    expect(normalize([1, 3])).toEqual([0.25, 0.75]);
    expect(argmax([0.2, 0.4, 0.4])).toBe(1);
    expect(distributionWithConfidence(1, 0, 0.3)).toEqual([1]);
    for (const value of distributionWithConfidence(3, 2, 0)) expect(value).toBeCloseTo(1 / 3, 12);
  });

  it('builds Choice and Score answers in the SDK shape', () => {
    expect(choiceAnswer(['x', 'y'], [1, 3])).toEqual({
      type: 'choice',
      choice: 'y',
      confidence: 0.5,
      probabilities: { x: 0.25, y: 0.75 },
    });
    expect(scoreAnswer(['a', null], [1, 1])).toEqual({
      type: 'score',
      score: 0.5,
      confidence: 0,
      legend: { '0': 'a', '1': null },
      probabilities: { '0': 0.5, '1': 0.5 },
    });
  });
});

describe('validateJevRequest', () => {
  const valid = { state: 's', questions: { q: noul } };

  it('resolves the model alias and defaults to jev-latest', () => {
    expect(validateJevRequest(valid, models)).toMatchObject({
      ok: true,
      request: { model: 'jev-1.13.0' },
    });
    expect(validateJevRequest({ ...valid, model: 'jev-1.12.0' }, models)).toMatchObject({
      ok: true,
      request: { model: 'jev-1.12.0' },
    });
    expect(validateJevRequest({ ...valid, model: null }, models)).toMatchObject({ ok: true });
  });

  it('reports every problem with a FastAPI-style location', () => {
    const locs = (body: unknown): string[] => {
      const result = validateJevRequest(body, models);
      return result.ok ? [] : result.issues.map((issue) => `${issue.loc.join('.')}:${issue.type}`);
    };
    expect(locs([])).toEqual(['body:dict_type']);
    expect(locs({})).toEqual(['body.state:missing', 'body.questions:missing']);
    expect(locs({ state: 3, questions: [], model: 7 })).toEqual([
      'body.state:entry_type',
      'body.questions:dict_type',
      'body.model:string_type',
    ]);
    expect(locs({ state: null, questions: {} })).toEqual(['body.questions:too_short']);
    expect(
      locs({
        state: null,
        questions: {
          '': noul,
          notObject: 5,
          badInstructions: { type: 'noul', instructions: 1 },
          choiceList: { type: 'choice', criteria: ['a'] },
          choiceEmpty: { type: 'choice', criteria: {} },
          choiceLabel: { type: 'choice', criteria: { '': 'x', ok: 2 } },
          scoreMap: { type: 'score', criteria: { a: 1 } },
          scoreShort: { type: 'score', criteria: ['one'] },
          scoreEntry: { type: 'score', criteria: ['a', true] },
          noulMap: { type: 'noul', criteria: 'x' },
          noulKeys: { type: 'noul', criteria: { maybe: 'x', true: 1 } },
          ranking: { type: 'ranking' },
        },
        model: 'jev-9',
      }),
    ).toEqual([
      'body.questions.:string_too_short',
      'body.questions.notObject:dict_type',
      'body.questions.badInstructions.instructions:entry_type',
      'body.questions.choiceList.criteria:dict_type',
      'body.questions.choiceEmpty.criteria:too_short',
      'body.questions.choiceLabel.criteria.:string_too_short',
      'body.questions.choiceLabel.criteria.ok:entry_type',
      'body.questions.scoreMap.criteria:list_type',
      'body.questions.scoreShort.criteria:too_short',
      'body.questions.scoreEntry.criteria.1:entry_type',
      'body.questions.noulMap.criteria:dict_type',
      'body.questions.noulKeys.criteria.maybe:extra_forbidden',
      'body.questions.noulKeys.criteria.true:entry_type',
      'body.questions.ranking.type:union_tag_invalid',
      'body.model:model_not_found',
    ]);
  });

  it('enforces the context budget of the state plus the longest question', () => {
    const big = 'x'.repeat(MAX_CONTEXT_TOKENS * 4);
    const result = validateJevRequest({ state: big, questions: { q: noul } }, models);
    expect(result).toMatchObject({ ok: false, issues: [{ type: 'context_length_exceeded' }] });
  });
});

describe('scripted answers', () => {
  it('looks keys up exactly first, then by the most specific wildcard', () => {
    const answers = { expect_1: 0.1, 'expect_*': 0.2, '*': 0.3, 'probe_*_ui': 0.4 };
    expect(lookupAnswer(answers, 'expect_1')).toBe(0.1);
    expect(lookupAnswer(answers, 'expect_7')).toBe(0.2);
    expect(lookupAnswer(answers, 'probe_error_ui')).toBe(0.4);
    expect(lookupAnswer(answers, 'other')).toBe(0.3);
    expect(lookupAnswer({}, 'other')).toBeUndefined();
  });

  it('builds each question type from each script form', () => {
    expect(answerFromScript(pick, 'p', 'b')).toMatchObject({
      ok: true,
      answer: { choice: 'b', confidence: 1 },
    });
    expect(answerFromScript(pick, 'p', { choice: 'a', confidence: 0.5 })).toMatchObject({
      ok: true,
      answer: { choice: 'a', confidence: 0.5 },
    });
    expect(answerFromScript(pick, 'p', { probabilities: { c: 2, a: 1 } })).toMatchObject({
      ok: true,
      answer: { choice: 'c' },
    });
    expect(answerFromScript(noul, 'n', true)).toEqual({
      ok: true,
      answer: { type: 'noul', noul: 1 },
    });
    expect(answerFromScript(noul, 'n', false)).toEqual({
      ok: true,
      answer: { type: 'noul', noul: 0 },
    });
    expect(answerFromScript(noul, 'n', { noul: 0.25 })).toEqual({
      ok: true,
      answer: { type: 'noul', noul: 0.25 },
    });
    expect(answerFromScript(rate, 'r', 2)).toMatchObject({
      ok: true,
      answer: { score: 2, confidence: 1 },
    });
    expect(answerFromScript(rate, 'r', { score: 1, confidence: 0 })).toMatchObject({
      ok: true,
      answer: { confidence: 0 },
    });
    expect(answerFromScript(rate, 'r', { probabilities: { '2': 1 } })).toMatchObject({
      ok: true,
      answer: { score: 2 },
    });
  });

  it('explains every script mistake', () => {
    const message = (
      question: JevQuestion,
      spec: Parameters<typeof answerFromScript>[2],
    ): string => {
      const built = answerFromScript(question, 'k', spec);
      return built.ok ? '' : built.message;
    };
    expect(message(pick, 'z')).toMatch(/not an option/);
    expect(message(pick, 3)).toMatch(/is a Choice/);
    expect(message(pick, { choice: 'a', confidence: 2 })).toMatch(/confidence/);
    expect(message(pick, { probabilities: { z: 1 } })).toMatch(/not an option/);
    expect(message(pick, { probabilities: { a: -1 } })).toMatch(/non-negative/);
    expect(message(noul, 'yes')).toMatch(/is a Noul/);
    expect(message(noul, 1.5)).toMatch(/is a Noul/);
    expect(message(rate, 3)).toMatch(/levels 0 to 2/);
    expect(message(rate, 'high')).toMatch(/levels 0 to 2/);
    expect(message(rate, { score: 1, confidence: -1 })).toMatch(/confidence/);
    expect(message(rate, { probabilities: { '5': 1 } })).toMatch(/not an option/);
  });

  it('runs rules, queues and fallbacks', () => {
    const runner = new ScriptRunner({
      answers: { q: true },
      rules: [
        {
          match: { questions: ['p'], model: 'jev-1.13.0' },
          answers: { p: 'a' },
          outcomes: [{ status: 429 }],
        },
        {
          match: { stateIncludes: 'modal', where: (r) => r.model === 'jev-1.13.0' },
          answers: { q: false },
        },
      ],
      outcomes: [{ delayMs: 5 }],
    });
    expect(runner.pending).toBe(2);
    const first = runner.next(request({ p: pick, q: noul }));
    expect(first.outcome).toEqual({ status: 429 });
    expect(runner.next(request({ p: pick })).outcome).toEqual({ delayMs: 5 });
    const modal = runner.next(request({ q: noul }, { page: 'blocking modal' }));
    expect(modal.answers.q).toBe(false);
    expect(runner.next(request({ q: noul }, { page: 'x' })).answers.q).toBe(true);
    expect(runner.next({ ...request({ p: pick }), model: 'jev-1.12.0' }).answers.p).toBeUndefined();
    runner.enqueue({ hang: true });
    expect(runner.pending).toBe(1);
    runner.replace({ fallback: 'uniform' });
    expect(runner.pending).toBe(0);
    expect(runner.answer(request({ p: pick, q: noul, r: rate }), {})).toMatchObject({
      ok: true,
      answers: { p: { confidence: 0 }, q: { noul: 0.5 }, r: { score: 1 } },
    });
    runner.replace({});
    expect(runner.answer(request({ q: noul }), {})).toEqual({
      ok: false,
      message: "no scripted answer for question 'q'",
    });
    expect(runner.answer(request({ q: noul }), { q: 'x' })).toMatchObject({ ok: false });
    expect(runner.script).toEqual({});
  });
});

describe('oracle', () => {
  const truth = (value: Record<string, unknown>) => () => value as Record<string, never>;

  it('turns truths into certain answers at noise 0, and noisy ones deterministically', () => {
    const req = request({ p: pick, q: noul, r: rate, u: noul });
    const exact = oracleAnswers(req, { truth: truth({ p: ['a', 'b'], q: false, r: 0, u: 0.3 }) });
    expect(exact).toMatchObject({
      ok: true,
      answers: {
        p: { probabilities: { a: 0.5, b: 0.5, c: 0 } },
        q: { noul: 0 },
        r: { score: 0 },
        u: { noul: 0.3 },
      },
    });
    const noisy = oracleAnswers(req, { truth: truth({ p: 'c', q: true }), noise: 0.4, seed: 'x' });
    const again = oracleAnswers(req, { truth: truth({ p: 'c', q: true }), noise: 0.4, seed: 'x' });
    expect(noisy).toEqual(again);
    if (!noisy.ok) throw new Error('oracle failed');
    expect(noisy.answers.p?.type === 'choice' && noisy.answers.p.choice).toBe('c');
    expect(noisy.answers.r).toMatchObject({ confidence: 0 });
  });

  it('refuses truths that do not fit the question', () => {
    const req = request({ p: pick, q: noul, r: rate });
    const message = (value: Record<string, unknown>, noise = 0): string => {
      const result = oracleAnswers(req, { truth: truth(value), noise });
      return result.ok ? '' : result.message;
    };
    expect(message({ p: 'z' })).toMatch(/not an option/);
    expect(message({ p: [] })).toMatch(/not an option/);
    expect(message({ p: true })).toMatch(/label or a list/);
    expect(message({ q: 'yes' })).toMatch(/boolean or a probability/);
    expect(message({ q: 2 })).toMatch(/boolean or a probability/);
    expect(message({ r: 1.5 })).toMatch(/level from 0 to 2/);
    expect(message({}, 2)).toMatch(/noise must lie in \[0, 1\]/);
  });

  it('builds a truth function from target descriptions', () => {
    const fn = oracleFromTargets(
      { 'Start C12': 'c17', 'Missing thing': null },
      { fallback: () => ({ probe_error_ui: false }) },
    );
    const state = {
      step: { target: { description: 'Start C12' } },
      candidates: { c16: {}, c17: {} },
      top: { a: { cid: 'c17' }, b: 'c16', c: { id: 'c99' }, d: 42 },
    };
    const questions = {
      target: { type: 'choice', criteria: { c16: null, c17: null } },
      target_present: noul,
      confirm_a: noul,
      confirm_b: noul,
      confirm_c: noul,
      confirm_d: noul,
      probe_error_ui: noul,
    } as const;
    expect(fn(request(questions, state))).toEqual({
      probe_error_ui: false,
      target: 'c17',
      target_present: true,
      confirm_a: true,
      confirm_b: false,
      confirm_c: false,
      confirm_d: undefined,
    });
    expect(
      fn(request({ target: pick, target_present: noul }, { step: { target: 'Missing thing' } })),
    ).toEqual({
      probe_error_ui: false,
      target: undefined,
      target_present: false,
    });
    expect(fn(request({ target: pick }, { step: { target: 'Unknown' } }))).toEqual({
      probe_error_ui: false,
    });
    expect(oracleFromTargets({ x: 'a' })(request({ target: pick }, 'plain text'))).toEqual({});
    // Candidates come from the Choice options when the state names none.
    const custom = oracleFromTargets(
      { 'row 3': 'b' },
      {
        describe: (r) => (typeof r.state === 'string' ? r.state : undefined),
        presentKey: 'present',
        confirmPrefix: 'is_',
        confirmCandidate: (_r, key) => key.slice(3),
      },
    );
    expect(custom(request({ pick, present: noul, is_b: noul, is_a: noul }, 'row 3'))).toEqual({
      pick: 'b',
      present: true,
      is_b: true,
      is_a: false,
    });
    expect(custom(request({ present: noul }, 'row 3'))).toEqual({ present: false });
  });

  it('keeps the fallback truth of Choice questions that are not about the target', () => {
    const fn = oracleFromTargets(
      { 'Start C12': 'c17', 'Missing thing': null },
      { fallback: () => ({ status: 'stopped', target: 'c16' }) },
    );
    const status = { type: 'choice', criteria: { running: null, stopped: null } } as const;
    const target = { type: 'choice', criteria: { c16: null, c17: null } } as const;
    const known = { step: { target: 'Start C12' } };
    expect(fn(request({ target, status }, known))).toEqual({ status: 'stopped', target: 'c17' });
    expect(fn(request({ target, status }, { step: { target: 'Unknown' } }))).toEqual({
      status: 'stopped',
      target: 'c16',
    });
    // An absent target makes the candidate Choice uniform; the other Choice keeps its truth.
    const absent = fn(request({ target, status }, { step: { target: 'Missing thing' } }));
    expect(absent.status).toBe('stopped');
    expect(absent.target).toBeUndefined();
    // With listed candidates, a Choice over some of them that lacks the target is uniform.
    const listed = fn(
      request(
        { shortlist: { type: 'choice', criteria: { c16: null, c18: null } }, status },
        { step: { target: 'Start C12' }, candidates: { c16: {}, c17: {}, c18: {} } },
      ),
    );
    expect(listed).toEqual({ status: 'stopped', target: 'c16', shortlist: undefined });
    expect(Object.hasOwn(listed, 'shortlist')).toBe(true);
  });

  it('seeds randomness from any JSON value', () => {
    const a = seededRandom({ seed: 1 });
    const b = seededRandom({ seed: 1 });
    const c = seededRandom({ seed: 2 });
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(c()).not.toBe(first[0]);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
