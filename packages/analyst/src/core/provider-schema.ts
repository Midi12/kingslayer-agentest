/**
 * The JSON schema sent to a provider as a structured-output hint (ADR M07-llm-port).
 * Providers accept a subset of JSON Schema: no length, pattern, numeric or array-size
 * constraints, every object closed. `providerSchema` reduces a contract schema to that
 * subset; the answer is still validated against the full contract schema afterwards.
 * The per-call schemas also narrow enums to the closed menus of the request.
 */
import {
  exportJsonSchema,
  type BreakPacket,
  type SchemaName,
  type VisualGroundRequest,
} from '@argus/contracts';

type Json = Record<string, unknown>;

const DROPPED_KEYWORDS = new Set([
  '$schema',
  '$id',
  'title',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'patternProperties',
  'discriminator',
  'x-runner-only',
  'default',
  'examples',
]);

const SUPPORTED_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A schema that admits any JSON scalar: the stand-in for an unconstrained `{}`. */
const ANY_SCALAR: Json = {
  anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
};

/** The provider subset of a JSON schema (see the module comment). */
export function providerSchema(schema: unknown): Json {
  if (!isObject(schema)) {
    return { ...ANY_SCALAR };
  }
  const keys = Object.keys(schema).filter((key) => key !== 'description');
  if (keys.length === 0) {
    return { ...ANY_SCALAR };
  }
  const out: Json = {};
  for (const [key, value] of Object.entries(schema)) {
    if (DROPPED_KEYWORDS.has(key)) continue;
    if (key === 'format' && !(typeof value === 'string' && SUPPORTED_FORMATS.has(value))) continue;
    if (key === 'minItems') {
      if (value === 0 || value === 1) out[key] = value;
      continue;
    }
    if (key === 'properties' && isObject(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, property]) => [name, providerSchema(property)]),
      );
    } else if ((key === 'anyOf' || key === 'allOf' || key === 'oneOf') && Array.isArray(value)) {
      out[key === 'oneOf' ? 'anyOf' : key] = value.map((variant) => providerSchema(variant));
    } else if (key === 'items') {
      out[key] = providerSchema(value);
    } else if (key === 'additionalProperties') {
      out[key] = false;
    } else {
      out[key] = value;
    }
  }
  if (out.type === 'object' || isObject(out.properties)) {
    out.additionalProperties = false;
    if (out.properties === undefined) out.properties = {};
  }
  return out;
}

/** The `type` constants a variant of an action union admits (through nested anyOf). */
function variantTypes(variant: unknown): string[] {
  if (!isObject(variant)) return [];
  if (Array.isArray(variant.anyOf)) {
    return variant.anyOf.flatMap((inner) => variantTypes(inner));
  }
  const properties = isObject(variant.properties) ? variant.properties : {};
  const type = properties.type;
  if (!isObject(type)) return [];
  if (typeof type.const === 'string') return [type.const];
  if (Array.isArray(type.anyOf)) {
    return type.anyOf.flatMap((option) =>
      isObject(option) && typeof option.const === 'string' ? [option.const] : [],
    );
  }
  return [];
}

/** An action union narrowed to the allowed action types; undefined when none remains. */
function narrowActions(union: unknown, allowed: readonly string[]): Json | undefined {
  if (!isObject(union) || !Array.isArray(union.anyOf)) return undefined;
  const kept: unknown[] = [];
  for (const variant of union.anyOf) {
    const types = variantTypes(variant).filter((type) => allowed.includes(type));
    if (types.length === 0 || !isObject(variant)) continue;
    const properties = isObject(variant.properties) ? variant.properties : undefined;
    if (
      properties !== undefined &&
      isObject(properties.type) &&
      Array.isArray(properties.type.anyOf)
    ) {
      kept.push({
        ...variant,
        properties: { ...properties, type: { type: 'string', enum: types } },
      });
    } else {
      kept.push(variant);
    }
  }
  return kept.length === 0 ? undefined : { anyOf: kept };
}

function stringEnum(values: readonly string[]): Json {
  return { type: 'string', enum: [...values] };
}

/** The contract schema as a plain JSON object. */
function contract(name: SchemaName): Json {
  const schema = exportJsonSchema(name);
  return JSON.parse(JSON.stringify(schema)) as Json;
}

function propertiesOf(schema: Json): Json {
  const properties = schema.properties;
  if (!isObject(properties)) {
    throw new RangeError('schema has no properties');
  }
  return properties;
}

/** The triage answer schema for one packet: its menu, patch actions, candidates, frames. */
export function triageAnswerSchema(packet: BreakPacket): Json {
  const schema = contract('AnalystDecision');
  const properties = propertiesOf(schema);
  properties.decision = stringEnum(packet.allowed.decisions);
  const patchItems = isObject(properties.patch) ? properties.patch.items : undefined;
  const narrowed = packet.allowed.decisions.includes('PATCH')
    ? narrowActions(patchItems, packet.allowed.patchActions)
    : undefined;
  if (narrowed === undefined) {
    delete properties.patch;
  } else {
    properties.patch = { type: 'array', items: narrowed };
  }
  const cids = (packet.candidates ?? []).map((candidate) => candidate.cid);
  if (packet.allowed.decisions.includes('RESOLVE_TARGET') && cids.length > 0) {
    properties.resolveTarget = {
      type: 'object',
      additionalProperties: false,
      required: ['cid'],
      properties: { cid: stringEnum(cids) },
    };
  } else {
    delete properties.resolveTarget;
  }
  const evidence = isObject(properties.evidence) ? properties.evidence.items : undefined;
  if (isObject(evidence) && isObject(evidence.properties)) {
    const refs = packet.frames.map((frame) => frame.ref);
    if (refs.length > 0) {
      evidence.properties.frame = stringEnum(refs);
    } else {
      delete evidence.properties.frame;
    }
    const observations = (['before', 'after'] as const).filter(
      (key) => packet.observations[key] !== null,
    );
    if (observations.length > 0) {
      evidence.properties.observation = stringEnum(observations);
    } else {
      delete evidence.properties.observation;
    }
  }
  return providerSchema(schema);
}

/** The visual grounding answer schema: a mark from the request's closed set, or null. */
export function visualGroundAnswerSchema(request: VisualGroundRequest): Json {
  const schema = contract('VisualGroundResult');
  const properties = propertiesOf(schema);
  properties.mark = {
    anyOf: [stringEnum(request.marks.map((mark) => mark.mark)), { type: 'null' }],
  };
  return providerSchema(schema);
}

/** The vision assertion answer schema. */
export function visionAssertAnswerSchema(): Json {
  return providerSchema(contract('VisionAssertResult'));
}
