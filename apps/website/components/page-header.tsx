export function PageHeader({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  return (
    <section className="border-b bg-gradient-to-b from-secondary to-background">
      <div className="container py-14 md:py-20">
        {eyebrow && <p className="text-sm font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>}
        <h1 className="mt-2 max-w-3xl text-4xl font-extrabold tracking-tight md:text-5xl">{title}</h1>
        {description && <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{description}</p>}
      </div>
    </section>
  );
}

export function Prose({ children }: { children: React.ReactNode }) {
  return <div className="container max-w-3xl space-y-4 py-12 leading-relaxed [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-muted-foreground">{children}</div>;
}
