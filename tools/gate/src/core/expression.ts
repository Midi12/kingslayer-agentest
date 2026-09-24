/**
 * The pass-expression language of gate files. It is parsed and evaluated here; nothing
 * is ever handed to `eval` or `Function`.
 *
 *   expr    := or
 *   or      := and ( '||' and )*
 *   and     := unary ( '&&' unary )*
 *   unary   := '!' unary | compare
 *   compare := operand ( ( '==' | '!=' | '<' | '<=' | '>' | '>=' ) operand )?
 *   operand := number | string | 'true' | 'false' | 'null' | reference | '(' expr ')'
 *   reference := 'exitCode' | 'durationMs' | 'metrics' ( '.' segment )+
 *
 * `!` applies to a whole comparison: `!metrics.a == 1` reads as `!(metrics.a == 1)`.
 * Comparisons do not chain. `==` and `!=` compare numbers, strings, booleans and null
 * without coercion; the ordering operators need two numbers or two strings. `&&`, `||`
 * and `!` need booleans. A metric the command did not write makes the expression false
 * and is reported, whether or not evaluation would have reached it.
 */
import { type Result, err, ok } from './result.js';

export type Scalar = number | string | boolean | null;
export type CompareOperator = '==' | '!=' | '<' | '<=' | '>' | '>=';

export type Expression =
  | { readonly kind: 'literal'; readonly value: Scalar }
  | { readonly kind: 'exitCode' }
  | { readonly kind: 'durationMs' }
  | { readonly kind: 'metric'; readonly path: readonly string[] }
  | { readonly kind: 'not'; readonly operand: Expression }
  | { readonly kind: 'and' | 'or'; readonly left: Expression; readonly right: Expression }
  | {
      readonly kind: 'compare';
      readonly operator: CompareOperator;
      readonly left: Expression;
      readonly right: Expression;
    };

export interface ExpressionError {
  readonly message: string;
  readonly position: number;
}

type Token =
  | { readonly type: 'number'; readonly value: number; readonly position: number }
  | { readonly type: 'string'; readonly value: string; readonly position: number }
  | { readonly type: 'word'; readonly value: string; readonly position: number }
  | { readonly type: 'op'; readonly value: string; readonly position: number }
  | { readonly type: 'end'; readonly position: number };

class ParseFailure extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

const OPERATORS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '!', '(', ')', '.'] as const;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const WORD = /^[A-Za-z_][A-Za-z0-9_]*/;
const DIGITS = /^\d+/;
const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\',
  "'": "'",
  '"': '"',
  n: '\n',
  t: '\t',
  r: '\r',
};

function readString(source: string, start: number): { value: string; end: number } {
  const quote = source.charAt(start);
  let value = '';
  let index = start + 1;
  while (index < source.length) {
    const char = source.charAt(index);
    if (char === quote) {
      return { value, end: index + 1 };
    }
    if (char === '\\') {
      const escaped = ESCAPES[source.charAt(index + 1)];
      if (escaped === undefined) {
        throw new ParseFailure(`unknown escape \\${source.charAt(index + 1)}`, index);
      }
      value += escaped;
      index += 2;
      continue;
    }
    value += char;
    index += 1;
  }
  throw new ParseFailure('unterminated string', start);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source.charAt(index);
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const rest = source.slice(index);
    const previous = tokens.at(-1);
    const afterDot = previous?.type === 'op' && previous.value === '.';
    if (afterDot && DIGITS.test(rest)) {
      const digits = DIGITS.exec(rest)?.[0] ?? '';
      tokens.push({ type: 'word', value: digits, position: index });
      index += digits.length;
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number && (char !== '-' || !afterDot)) {
      tokens.push({ type: 'number', value: Number(number[0]), position: index });
      index += number[0].length;
      continue;
    }
    const word = WORD.exec(rest);
    if (word) {
      tokens.push({ type: 'word', value: word[0], position: index });
      index += word[0].length;
      continue;
    }
    if (char === "'" || char === '"') {
      const { value, end } = readString(source, index);
      tokens.push({ type: 'string', value, position: index });
      index = end;
      continue;
    }
    const operator = OPERATORS.find((candidate) => rest.startsWith(candidate));
    if (operator === undefined) {
      throw new ParseFailure(`unexpected character '${char}'`, index);
    }
    tokens.push({ type: 'op', value: operator, position: index });
    index += operator.length;
  }
  tokens.push({ type: 'end', position: source.length });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): Expression {
    const expression = this.or();
    const next = this.peek();
    if (next.type !== 'end') {
      throw new ParseFailure(`unexpected ${describeToken(next)}`, next.position);
    }
    return expression;
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { type: 'end', position: 0 };
  }

  private take(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token.type === 'op' && token.value === value;
  }

  private or(): Expression {
    let left = this.and();
    while (this.isOp('||')) {
      this.take();
      left = { kind: 'or', left, right: this.and() };
    }
    return left;
  }

  private and(): Expression {
    let left = this.unary();
    while (this.isOp('&&')) {
      this.take();
      left = { kind: 'and', left, right: this.unary() };
    }
    return left;
  }

  private unary(): Expression {
    if (this.isOp('!')) {
      this.take();
      return { kind: 'not', operand: this.unary() };
    }
    return this.compare();
  }

  private compare(): Expression {
    const left = this.operand();
    const token = this.peek();
    if (token.type === 'op' && isCompareOperator(token.value)) {
      this.take();
      const right = this.operand();
      const after = this.peek();
      if (after.type === 'op' && isCompareOperator(after.value)) {
        throw new ParseFailure('comparisons do not chain; use && between them', after.position);
      }
      return { kind: 'compare', operator: token.value, left, right };
    }
    return left;
  }

  private operand(): Expression {
    const token = this.take();
    switch (token.type) {
      case 'number':
        return { kind: 'literal', value: token.value };
      case 'string':
        return { kind: 'literal', value: token.value };
      case 'word':
        return this.word(token.value, token.position);
      case 'op':
        if (token.value === '(') {
          const inner = this.or();
          const close = this.take();
          if (close.type !== 'op' || close.value !== ')') {
            throw new ParseFailure(
              `expected ')' but found ${describeToken(close)}`,
              close.position,
            );
          }
          return inner;
        }
        throw new ParseFailure(`unexpected ${describeToken(token)}`, token.position);
      case 'end':
        throw new ParseFailure('unexpected end of expression', token.position);
    }
  }

  private word(value: string, position: number): Expression {
    switch (value) {
      case 'true':
        return { kind: 'literal', value: true };
      case 'false':
        return { kind: 'literal', value: false };
      case 'null':
        return { kind: 'literal', value: null };
      case 'exitCode':
        return { kind: 'exitCode' };
      case 'durationMs':
        return { kind: 'durationMs' };
      case 'metrics':
        return { kind: 'metric', path: this.path(position) };
      default:
        throw new ParseFailure(
          `unknown name '${value}'; use exitCode, durationMs or metrics.<path>`,
          position,
        );
    }
  }

  private path(position: number): string[] {
    const segments: string[] = [];
    while (this.isOp('.')) {
      this.take();
      const segment = this.take();
      if (segment.type !== 'word') {
        throw new ParseFailure(`expected a metric name after '.'`, segment.position);
      }
      segments.push(segment.value);
    }
    if (segments.length === 0) {
      throw new ParseFailure("'metrics' needs a path, for example metrics.tests", position);
    }
    return segments;
  }
}

function isCompareOperator(value: string): value is CompareOperator {
  return ['==', '!=', '<', '<=', '>', '>='].includes(value);
}

function describeToken(token: Token): string {
  switch (token.type) {
    case 'end':
      return 'end of expression';
    case 'string':
      return `string '${token.value}'`;
    default:
      return `'${String(token.value)}'`;
  }
}

/** Parses a pass expression. */
export function parseExpression(source: string): Result<Expression, ExpressionError> {
  try {
    return ok(new Parser(tokenize(source)).parse());
  } catch (error) {
    if (error instanceof ParseFailure) {
      return err({ message: error.message, position: error.position });
    }
    throw error;
  }
}

/** Every `metrics.<path>` the expression references, dotted, without duplicates. */
export function metricReferences(expression: Expression): string[] {
  const found = new Set<string>();
  const visit = (node: Expression): void => {
    switch (node.kind) {
      case 'metric':
        found.add(node.path.join('.'));
        return;
      case 'not':
        visit(node.operand);
        return;
      case 'and':
      case 'or':
      case 'compare':
        visit(node.left);
        visit(node.right);
        return;
      default:
        return;
    }
  };
  visit(expression);
  return [...found];
}

export interface EvaluationContext {
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly metrics: unknown;
}

export interface Evaluation {
  readonly pass: boolean;
  /** Metric paths the expression references that the command did not write. */
  readonly missingMetrics: readonly string[];
  /** Type errors, or a result that is not a boolean. */
  readonly errors: readonly string[];
}

/** Looks up a dotted path in a JSON value; undefined when any segment is absent. */
export function lookupMetric(metrics: unknown, path: readonly string[]): unknown {
  let current: unknown = metrics;
  for (const segment of path) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = (current as unknown[])[Number(segment)];
    } else if (
      typeof current === 'object' &&
      current !== null &&
      !Array.isArray(current) &&
      Object.hasOwn(current, segment)
    ) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

class TypeFailure extends Error {}

function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value === 'string'
    ? `string "${value}"`
    : `${typeof value} ${JSON.stringify(value)}`;
}

function asBoolean(value: unknown, operator: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeFailure(`'${operator}' needs booleans, got ${describeValue(value)}`);
  }
  return value;
}

function asScalar(value: unknown, operator: string): Scalar {
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  throw new TypeFailure(`'${operator}' cannot compare ${describeValue(value)}`);
}

function compare(operator: CompareOperator, leftValue: unknown, rightValue: unknown): boolean {
  const left = asScalar(leftValue, operator);
  const right = asScalar(rightValue, operator);
  if (operator === '==') {
    return left === right;
  }
  if (operator === '!=') {
    return left !== right;
  }
  const bothNumbers = typeof left === 'number' && typeof right === 'number';
  const bothStrings = typeof left === 'string' && typeof right === 'string';
  if (!bothNumbers && !bothStrings) {
    throw new TypeFailure(
      `'${operator}' needs two numbers or two strings, got ${describeValue(left)} and ${describeValue(right)}`,
    );
  }
  switch (operator) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
  }
}

function evaluateNode(node: Expression, context: EvaluationContext): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'exitCode':
      return context.exitCode;
    case 'durationMs':
      return context.durationMs;
    case 'metric':
      return lookupMetric(context.metrics, node.path);
    case 'not':
      return !asBoolean(evaluateNode(node.operand, context), '!');
    case 'and':
      return (
        asBoolean(evaluateNode(node.left, context), '&&') &&
        asBoolean(evaluateNode(node.right, context), '&&')
      );
    case 'or':
      return (
        asBoolean(evaluateNode(node.left, context), '||') ||
        asBoolean(evaluateNode(node.right, context), '||')
      );
    case 'compare':
      return compare(
        node.operator,
        evaluateNode(node.left, context),
        evaluateNode(node.right, context),
      );
  }
}

/** Evaluates a parsed pass expression against a command's outcome and metrics. */
export function evaluateExpression(expression: Expression, context: EvaluationContext): Evaluation {
  const missingMetrics = metricReferences(expression).filter(
    (path) => lookupMetric(context.metrics, path.split('.')) === undefined,
  );
  if (missingMetrics.length > 0) {
    return { pass: false, missingMetrics, errors: [] };
  }
  try {
    const value = evaluateNode(expression, context);
    if (typeof value !== 'boolean') {
      return {
        pass: false,
        missingMetrics: [],
        errors: [`the expression yields ${describeValue(value)}, not a boolean`],
      };
    }
    return { pass: value, missingMetrics: [], errors: [] };
  } catch (error) {
    if (error instanceof TypeFailure) {
      return { pass: false, missingMetrics: [], errors: [error.message] };
    }
    throw error;
  }
}
