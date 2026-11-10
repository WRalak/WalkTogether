import { AdminLogin } from '@/features/admin-login';

export const metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-destructive">Restricted area</p>
        <h1 className="mt-2 text-2xl font-bold">WalkTogether platform admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">Authorised staff only. All actions are audited.</p>
        <div className="mt-6">
          <AdminLogin />
        </div>
      </div>
    </div>
  );
}
