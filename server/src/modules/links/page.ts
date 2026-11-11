/**
 * Minimal server-rendered pages for links that are opened outside the app (email links, payment
 * returns, invitations, legal pages). There is deliberately no marketing website: these pages only
 * complete an action or hand the user back to the mobile app.
 */
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** Builds an app deep link (`walktogether://…`). */
export const appLink = (path: string) => `walktogether://${path.replace(/^\//, '')}`;

export function page(title: string, body: string, opts: { status?: 'ok' | 'error' } = {}) {
  const accent = opts.status === 'error' ? '#b42318' : '#0f766e';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · WalkTogether</title>
<style>
  :root { color-scheme: light dark; --fg:#111827; --muted:#4b5563; --bg:#f8fafc; --card:#fff; --accent:${accent}; }
  @media (prefers-color-scheme: dark) { :root { --fg:#f3f4f6; --muted:#9ca3af; --bg:#0b1120; --card:#111827; } }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width:560px; margin:0 auto; padding:40px 16px; }
  .card { background:var(--card); border-radius:16px; padding:28px; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .brand { font-weight:800; letter-spacing:-.01em; margin-bottom:20px; }
  h1 { font-size:1.4rem; margin:0 0 8px; color:var(--accent); }
  p, li { color:var(--muted); }
  label { display:block; font-weight:600; margin:16px 0 6px; }
  input { width:100%; padding:12px; border:1px solid #cbd5e1; border-radius:10px; font:inherit; background:transparent; color:inherit; }
  .btn { display:inline-block; margin-top:20px; padding:12px 18px; border-radius:10px; border:0; background:#0f766e; color:#fff; font:inherit; font-weight:600; text-decoration:none; cursor:pointer; }
  code { font-size:1.1rem; padding:2px 6px; border-radius:6px; background:rgba(15,118,110,.12); }
</style>
</head>
<body><main><div class="card"><div class="brand">WalkTogether</div>${body}</div></main></body>
</html>`;
}
