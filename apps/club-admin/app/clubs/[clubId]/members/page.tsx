'use client';
import { Suspense } from 'react';
import { MembersView } from '@/features/clubs/members-view';

export default function MembersPage() {
  return (
    <Suspense>
      <MembersView />
    </Suspense>
  );
}
