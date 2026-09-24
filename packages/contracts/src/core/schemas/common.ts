/**
 * Building blocks shared by every schema: literal unions, patterns and small value types.
 *
 * Schemas are TypeBox, so each one is JSON Schema and a static TypeScript type at once.
 * No schema uses the `format` keyword: patterns validate the same way in TypeBox, Ajv
 * and any other JSON Schema 2020-12 validator (ADR M01-schema-conventions).
 */
import {
  Type,
  type Static,
  type TLiteral,
  type TObject,
  type TSchema,
  type TUnion,
} from '@sinclair/typebox';
import { IMAGE_MEDIA_TYPES } from '../enums.js';

type LiteralValue = string | number | boolean;

/** A union of string literals (JSON Schema `anyOf` of `const`), from a const array. */
export function literalUnion<const T extends readonly LiteralValue[]>(
  values: T,
  options: { description?: string } = {},
): TUnion<TLiteral<T[number]>[]> {
  const literals = values.map((value) => Type.Literal(value));
  return Type.Union(literals, options);
}

/**
 * A union of object variants told apart by one property. The `discriminator` annotation
 * is the OpenAPI 3.1 keyword; `validate()` uses it to report errors inside the variant the
 * value selected instead of at the union.
 */
export function discriminatedUnion<T extends TSchema[]>(
  propertyName: string,
  variants: [...T],
  options: { description?: string } = {},
): TUnion<T> {
  return Type.Union(variants, { ...options, discriminator: { propertyName } }) as TUnion<T>;
}

/** A closed object: unknown properties are errors. */
export function closedObject<P extends Record<string, TSchema>>(
  properties: P,
  options: { description?: string; [key: string]: unknown } = {},
): TObject<P> {
  return Type.Object(properties, { ...options, additionalProperties: false });
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** ISO 8601 date-time with a zone, e.g. 2026-09-21T10:15:03.120Z. */
export const ISO_TIMESTAMP_PATTERN =
  '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]{1,9})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$';
/** `sha256:` followed by 64 lowercase hex digits (the output of `contentHash`). */
export const SHA256_PATTERN = '^sha256:[0-9a-f]{64}$';
/** Artifact reference in the object store namespace, e.g. art://runs/r1/s3/before.png. */
export const ARTIFACT_REF_PATTERN = '^art://[A-Za-z0-9._~!$&()*+,;=:@%/-]+$';
/** Lowercase slug: script, fragment and baseline names, tags. */
export const SLUG_PATTERN = '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$';
/** Step, handler and candidate-style identifiers. */
export const STEP_ID_PATTERN = '^[a-z0-9]([a-z0-9_-]{0,62}[a-z0-9])?$';
/** Variable names, usable as `${var.NAME}`. */
export const VARIABLE_NAME_PATTERN = '^[A-Za-z_][A-Za-z0-9_]{0,63}$';
/** Secret names, usable as `${secret.NAME}`. */
export const SECRET_NAME_PATTERN = '^[A-Z][A-Z0-9_]{0,63}$';
/** `within` and other durations: minutes, seconds and milliseconds, e.g. 10s, 1m30s, 500ms. */
export const DURATION_PATTERN = '^(?=[0-9])([0-9]+m(?!s))?([0-9]+s)?([0-9]+ms)?$';
/** BCP 47 language tag, as Playwright takes it. */
export const LOCALE_PATTERN = '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$';
/** IANA time zone name or UTC. */
export const TIMEZONE_PATTERN = '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+){1,2})$';
/** Candidate id inside one observation. */
export const CANDIDATE_ID_PATTERN = '^[A-Za-z0-9_-]{1,32}$';
/** Semantic-ish version string of a component. */
export const VERSION_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$';
/** Origin: scheme, host and optional port, no path. */
export const ORIGIN_PATTERN = '^https?://[^/\\s?#]+$';
/** Host with optional port, as allowed for the `http` action. */
export const HOST_PATTERN = '^[A-Za-z0-9.-]+(:[0-9]{1,5})?$';
/** Base64 (standard alphabet, padded). */
export const BASE64_PATTERN = '^[A-Za-z0-9+/]*={0,2}$';

// ---------------------------------------------------------------------------
// Small value types
// ---------------------------------------------------------------------------

export const IsoTimestamp = Type.String({
  pattern: ISO_TIMESTAMP_PATTERN,
  description: 'ISO 8601 timestamp with a zone',
});
export const Sha256 = Type.String({ pattern: SHA256_PATTERN, description: 'sha256:<64 hex>' });
export const ArtifactRef = Type.String({
  pattern: ARTIFACT_REF_PATTERN,
  maxLength: 1024,
  description: 'Artifact reference, art://…',
});
export const Slug = Type.String({ pattern: SLUG_PATTERN });
export const StepId = Type.String({ pattern: STEP_ID_PATTERN });
export const CandidateId = Type.String({ pattern: CANDIDATE_ID_PATTERN });
export const VariableName = Type.String({ pattern: VARIABLE_NAME_PATTERN });
export const SecretName = Type.String({ pattern: SECRET_NAME_PATTERN });
export const Duration = Type.String({
  pattern: DURATION_PATTERN,
  maxLength: 32,
  description: 'Duration such as 10s, 1m30s or 500ms',
});
export const NonEmptyText = (maxLength: number, description?: string) =>
  Type.String({
    minLength: 1,
    maxLength,
    ...(description === undefined ? {} : { description }),
  });
export const Probability = Type.Number({ minimum: 0, maximum: 1 });
export const NonNegativeInteger = Type.Integer({ minimum: 0 });
export const PositiveInteger = Type.Integer({ minimum: 1 });
export const Identifier = Type.String({ minLength: 1, maxLength: 128 });
export const Version = Type.String({ pattern: VERSION_PATTERN });

/** A scalar variable value. */
export const ScalarValue = Type.Union([
  Type.String({ maxLength: 4096 }),
  Type.Number(),
  Type.Boolean(),
]);
export type ScalarValue = Static<typeof ScalarValue>;

/** A map from probability keys (candidate ids or question ids) to probabilities. */
export const ProbabilityMap = Type.Record(
  Type.String({ pattern: '^[A-Za-z0-9_-]{1,64}$' }),
  Probability,
  {
    additionalProperties: false,
  },
);

/** An image inlined in a brain request, base64 encoded (at most about 8 MiB decoded). */
export const InlineImage = closedObject({
  mediaType: literalUnion(IMAGE_MEDIA_TYPES),
  data: Type.String({ pattern: BASE64_PATTERN, minLength: 4, maxLength: 11_184_812 }),
});
export type InlineImage = Static<typeof InlineImage>;

/** Token usage of a model call, as in `GroundResult.usage`. */
export const TokenUsage = closedObject({
  inputTokens: NonNegativeInteger,
  outputTokens: Type.Optional(NonNegativeInteger),
});
export type TokenUsage = Static<typeof TokenUsage>;

// Static types of the building blocks above, for consumers that build or read them.
export type IsoTimestamp = Static<typeof IsoTimestamp>;
export type Sha256 = Static<typeof Sha256>;
export type ArtifactRef = Static<typeof ArtifactRef>;
export type Slug = Static<typeof Slug>;
export type StepId = Static<typeof StepId>;
export type CandidateId = Static<typeof CandidateId>;
export type VariableName = Static<typeof VariableName>;
export type SecretName = Static<typeof SecretName>;
export type Duration = Static<typeof Duration>;
export type Probability = Static<typeof Probability>;
export type NonNegativeInteger = Static<typeof NonNegativeInteger>;
export type PositiveInteger = Static<typeof PositiveInteger>;
export type Identifier = Static<typeof Identifier>;
export type Version = Static<typeof Version>;
export type ProbabilityMap = Static<typeof ProbabilityMap>;
