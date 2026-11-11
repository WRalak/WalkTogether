import { ApiError } from '@walktogether/api-client';

export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.') {
  if (e instanceof ApiError) {
    if (e.code === 'VALIDATION_ERROR' && Array.isArray(e.details)) {
      return (e.details as { path: string; message: string }[]).map((d) => `${d.path ? `${d.path}: ` : ''}${d.message}`).join('; ');
    }
    return e.message;
  }
  return fallback;
}
