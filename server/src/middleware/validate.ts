import type { ZodTypeAny, z } from 'zod';

/** Parse and validate untrusted input. Throws ZodError, which the error handler maps to 422. */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  return schema.parse(input ?? {});
}
