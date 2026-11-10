import { RequireAuth } from '@/components/require-auth';
import { TopBar } from '@/components/top-bar';

export default function ClubsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <TopBar />
      {children}
    </RequireAuth>
  );
}
