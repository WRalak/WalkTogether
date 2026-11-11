import { Card, CardContent } from '@walktogether/ui';

export function FeatureGrid({ items }: { items: { title: string; body: string; status?: string }[] }) {
  return (
    <div className="container grid gap-5 py-12 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((f) => (
        <Card key={f.title}>
          <CardContent className="p-6">
            <h2 className="text-lg font-bold">{f.title}</h2>
            <p className="mt-2 text-muted-foreground">{f.body}</p>
            {f.status && <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-accent">{f.status}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
