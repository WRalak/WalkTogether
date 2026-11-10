import { loginSchema, normaliseKenyanPhone, phoneFormSchema, registerFormSchema } from '@/features/auth-schemas';

describe('auth form schemas', () => {
  it('normalises Kenyan phone numbers to E.164', () => {
    expect(normaliseKenyanPhone('0712 345 678')).toBe('+254712345678');
    expect(normaliseKenyanPhone('0112345678')).toBe('+254112345678');
    expect(normaliseKenyanPhone('712345678')).toBe('+254712345678');
    expect(normaliseKenyanPhone('254712345678')).toBe('+254712345678');
    expect(normaliseKenyanPhone('+256772123456')).toBe('+256772123456');
    expect(phoneFormSchema.safeParse({ phone: '12' }).success).toBe(false);
  });

  it('validates login and registration', () => {
    expect(loginSchema.safeParse({ email: 'x', password: 'y' }).success).toBe(false);
    expect(registerFormSchema.safeParse({ displayName: 'Akinyi', username: 'akinyi', email: 'a@b.co', password: 'walk2gether-ok' }).success).toBe(true);
    expect(registerFormSchema.safeParse({ displayName: 'Akinyi', username: 'akinyi', email: 'a@b.co', password: 'short' }).success).toBe(false);
  });
});
