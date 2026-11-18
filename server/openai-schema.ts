/** Convert shared tools to OpenAI strict schemas and restore optional-field semantics. */
type Schema = Record<string, unknown>;

export function strictToolSchema(schema: Schema): Schema {
  const result = { ...schema };
  delete result.nullable;
  if (typeof result.type === 'string') result.type = result.type.toLowerCase();
  if (result.type === 'string' && result.maxLength === undefined) result.maxLength = 350;
  if (result.properties && typeof result.properties === 'object') {
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const properties = Object.entries(result.properties).map(([name, property]) => {
      const nested = strictToolSchema(property as Schema);
      return [name, required.has(name) ? nested : { anyOf: [nested, { type: 'null' }] }];
    });
    result.properties = Object.fromEntries(properties);
    result.required = properties.map(([name]) => name);
    result.additionalProperties = false;
  }
  if (result.items && typeof result.items === 'object')
    result.items = strictToolSchema(result.items as Schema);
  return schema.nullable === true ? { anyOf: [result, { type: 'null' }] } : result;
}

/** Null represents an omitted optional field on the wire. Required nulls stay invalid. */
export function restoreOptionalFields(value: unknown, schema: Schema): unknown {
  if (Array.isArray(value) && schema.items && typeof schema.items === 'object')
    return value.map((item) => restoreOptionalFields(item, schema.items as Schema));
  if (!value || typeof value !== 'object' || Array.isArray(value) || !schema.properties)
    return value;
  const properties = schema.properties as Record<string, Schema>;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, item]) => {
      if (!Object.hasOwn(properties, name)) return [[name, item]];
      if (item === null && !required.has(name)) return [];
      return [[name, restoreOptionalFields(item, properties[name])]];
    }),
  );
}
