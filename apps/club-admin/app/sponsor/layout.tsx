import { RequireAuth } from '@/components/require-auth';
import { TopBar } from '@/components/top-bar';

export default function SponsorLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <TopBar />
      <div className="mx-auto max-w-4xl px-4 py-10">{children}</div>
    </RequireAuth>
  );
}
