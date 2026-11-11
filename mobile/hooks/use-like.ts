import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { Page, PostDto } from '@walktogether/api-client';
import { api } from '@/services/api';

/** Optimistic like toggle that patches any cached feed pages and the post detail. */
export function useLike() {
  const qc = useQueryClient();
  return async (p: PostDto) => {
    const next = !p.likedByMe;
    const patch = (x: PostDto) => (x.id === p.id ? { ...x, likedByMe: next, likeCount: x.likeCount + (next ? 1 : -1) } : x);
    qc.setQueriesData<InfiniteData<Page<PostDto>>>({ queryKey: ['feed'] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map(patch) })) });
    qc.setQueryData<PostDto>(['post', p.id], (d) => d && patch(d));
    try {
      await api.social.like(p.id, next);
    } catch {
      void qc.invalidateQueries({ queryKey: ['feed'] });
      void qc.invalidateQueries({ queryKey: ['post', p.id] });
    }
  };
}
