'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, CardContent, Input, Spinner, Table, Td, Th } from '@walktogether/ui';
import { adminApi } from '@/lib/api';
import { useAdminAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

function SettingRow({ k, value, onSave }: { k: string; value: unknown; onSave: (v: unknown) => Promise<void> }) {
  const [text, setText] = useState(JSON.stringify(value));
  const [err, setErr] = useState<string | null>(null);
  return (
    <tr>
      <Td className="font-mono text-xs">{k}</Td>
      <Td>
        <Input aria-label={`Value for ${k}`} className="h-9 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
        {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
      </Td>
      <Td className="text-right">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            setErr(null);
            try {
              await onSave(JSON.parse(text));
            } catch (e) {
              setErr(e instanceof SyntaxError ? 'Value must be valid JSON (e.g. true, 5, "text", ["KE"])' : errorMessage(e));
            }
          }}
        >
          Save
        </Button>
      </Td>
    </tr>
  );
}

export default function SettingsPage() {
  const { can } = useAdminAuth();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => adminApi.settings.list(), enabled: can('settings.manage') });
  const flags = useQuery({ queryKey: ['flags'], queryFn: () => adminApi.featureFlags.list(), enabled: can('feature_flags.manage') });
  const [error, setError] = useState<string | null>(null);
  if (!can('settings.manage')) return <Alert variant="destructive">You don’t have permission to manage platform settings.</Alert>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Settings & feature flags</h1>
      {error && <Alert variant="destructive">{error}</Alert>}
      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="font-semibold">Platform settings</h2>
          {settings.isLoading ? (
            <Spinner />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Key</Th>
                  <Th>Value (JSON)</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {settings.data?.map((s) => (
                  <SettingRow
                    key={s.key}
                    k={s.key}
                    value={s.value}
                    onSave={async (v) => {
                      await adminApi.settings.set(s.key, v);
                      await qc.invalidateQueries({ queryKey: ['settings'] });
                    }}
                  />
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
      {can('feature_flags.manage') && (
        <Card>
          <CardContent className="space-y-3 p-6">
            <h2 className="font-semibold">Feature flags</h2>
            {flags.isLoading ? (
              <Spinner />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Flag</Th>
                    <Th>Description</Th>
                    <Th>Enabled</Th>
                  </tr>
                </thead>
                <tbody>
                  {flags.data?.map((f) => (
                    <tr key={f.key}>
                      <Td className="font-mono text-xs">{f.key}</Td>
                      <Td className="text-sm text-muted-foreground">{f.description}</Td>
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`Enable ${f.key}`}
                          className="h-4 w-4"
                          checked={f.enabled}
                          onChange={async (e) => {
                            setError(null);
                            try {
                              await adminApi.featureFlags.set(f.key, e.target.checked, f.rolloutPercentage || 100);
                              await qc.invalidateQueries({ queryKey: ['flags'] });
                            } catch (err) {
                              setError(errorMessage(err));
                            }
                          }}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
