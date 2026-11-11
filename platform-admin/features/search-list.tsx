'use client';
import { useState } from 'react';
import { Button, Input, Select } from '@walktogether/ui';

export function SearchBar({ statuses, onSearch }: { statuses: string[]; onSearch: (q: string, status: string) => void }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  return (
    <form
      role="search"
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(q.trim(), status);
      }}
    >
      <label htmlFor="q" className="sr-only">
        Search
      </label>
      <Input id="q" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="sm:max-w-sm" />
      <label htmlFor="status" className="sr-only">
        Status
      </label>
      <Select id="status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
        <option value="">All statuses</option>
        {statuses.map((s) => (
          <option key={s} value={s}>
            {s.replace('_', ' ').toLowerCase()}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  );
}
