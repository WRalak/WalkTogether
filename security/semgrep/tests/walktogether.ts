// Fixture for `semgrep --test`: every `ruleid:` line must be flagged, every `ok:` line must not.
declare const prisma: any, req: any, res: any, logger: any, AsyncStorage: any, jwtVerify: any, key: any, token: string, confirmPayment: any;

async function examples(id: string) {
  // ruleid: wt-prisma-raw-unsafe-interpolation
  await prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = '${id}'`);
  // ok: wt-prisma-raw-unsafe-interpolation
  await prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`;

  // ruleid: wt-jwt-verify-without-algorithms
  await jwtVerify(token, key, { issuer: 'x' });
  // ok: wt-jwt-verify-without-algorithms
  await jwtVerify(token, key, { issuer: 'x', algorithms: ['RS256'] });

  // ruleid: wt-cookie-without-httponly
  res.cookie('sid', token, { secure: true });
  // ok: wt-cookie-without-httponly
  res.cookie('sid', token, { httpOnly: true, secure: true, sameSite: 'strict' });

  // ruleid: wt-ssrf-fetch-from-request
  await fetch(req.body.url);
  // ok: wt-ssrf-fetch-from-request
  await fetch('https://api.stripe.com/v1/charges');

  // ruleid: wt-html-response-without-escaping
  res.send(`<p>Hello ${req.query.name}</p>`);

  // ruleid: wt-log-sensitive-values
  logger.info({ password: req.body.password }, 'login');
  // ok: wt-log-sensitive-values
  logger.info({ userId: id }, 'login');

  // ruleid: wt-client-trusted-payment-status
  await confirmPayment(req.body.paymentId, 'client');

  // ruleid: wt-async-storage-for-secrets
  await AsyncStorage.setItem('refreshToken', token);
  // ok: wt-async-storage-for-secrets
  await AsyncStorage.setItem('theme', 'dark');
}

function makeResetToken() {
  // ruleid: wt-insecure-randomness-for-secrets
  return Math.random().toString(36);
}
