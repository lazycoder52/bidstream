import { EnvSchema, AppEnv } from '@bidstream/contracts';

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    throw new Error(`Environment configuration error: ${errorDetails}`);
  }
  return result.data;
}
