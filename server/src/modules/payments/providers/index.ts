import { env } from '../../../config/env';
import { AppError } from '../../../shared/errors';
import { MpesaProvider } from './mpesa';
import { SandboxProvider } from './sandbox';
import { StripeProvider } from './stripe';
import type { PaymentProvider } from './types';

const registry = new Map<string, PaymentProvider>();
for (const id of env.PAYMENT_PROVIDERS) {
  if (id === 'mpesa') registry.set(id, new MpesaProvider());
  if (id === 'stripe') registry.set(id, new StripeProvider());
  if (id === 'sandbox') registry.set(id, new SandboxProvider());
}

export function getProvider(id: string): PaymentProvider {
  const p = registry.get(id);
  if (!p) throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', `Payment provider "${id}" is not enabled on this server`);
  return p;
}

export function enabledProviders() {
  return [...registry.values()].map((p) => ({ id: p.id, currencies: p.currencies }));
}
