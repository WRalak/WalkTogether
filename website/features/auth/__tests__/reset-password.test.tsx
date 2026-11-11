import { describe, expect, it } from 'vitest';
import { resetFormSchema } from '../reset-password-form';

describe('reset password form validation', () => {
  it('requires matching, strong passwords', () => {
    expect(resetFormSchema.safeParse({ password: 'short', confirm: 'short' }).success).toBe(false);
    expect(resetFormSchema.safeParse({ password: 'walk2gether-ok', confirm: 'walk2gether-no' }).success).toBe(false);
    expect(resetFormSchema.safeParse({ password: 'walk2gether-ok', confirm: 'walk2gether-ok' }).success).toBe(true);
  });
});
