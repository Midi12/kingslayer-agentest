/**
 * Discriminated unions: the `discriminator` annotation (OpenAPI 3.1) names the property
 * whose literal value selects a variant.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** The discriminator property of a union schema, if it declares one. */
export function discriminatorOf(schema: unknown): string | undefined {
  const name = asRecord(asRecord(schema).discriminator).propertyName;
  return typeof name === 'string' ? name : undefined;
}

/** The values a variant accepts for the discriminator property (nested unions included). */
export function discriminatorValues(schema: unknown, property: string): unknown[] {
  const node = asRecord(schema);
  if (Array.isArray(node.anyOf)) {
    return node.anyOf.flatMap((variant) => discriminatorValues(variant, property));
  }
  const properties = asRecord(node.properties);
  const tag = asRecord(properties[property]);
  if ('const' in tag) return [tag.const];
  if (Array.isArray(tag.anyOf)) return tag.anyOf.flatMap((option) => asRecord(option).const);
  if (Array.isArray(tag.enum)) return tag.enum as unknown[];
  return [];
}
