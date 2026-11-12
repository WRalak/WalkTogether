import { ApiError } from '@walktogether/api-client';

export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.') {
  if (e instanceof ApiError) {
    if (e.code === 'VALIDATION_ERROR' && Array.isArray(e.details)) return (e.details as { message: string }[]).map((d) => d.message).join('\n');
    return e.message;
  }
  if (e instanceof TypeError || (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')))
    return 'Can’t reach WalkTogether. Check your connection and try again.';
  // Plain Errors are thrown by our own client-side validation with user-facing messages.
  if (e instanceof Error && e.name === 'Error' && e.message) return e.message;
  return fallback;
}

export function isNetworkError(e: unknown) {
  return !(e instanceof ApiError) && (e instanceof TypeError || (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')));
}
