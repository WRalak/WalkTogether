export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <p className="flex items-center gap-2 font-extrabold">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-primary text-xs text-primary-foreground">WT</span>
          WalkTogether Clubs
        </p>
        <h1 className="mt-6 text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
