import type { ChallengeDto } from '@walktogether/api-client';
import { formatDuration, km } from './units';

export function metricValue(metric: ChallengeDto['metric'], v: number) {
  if (metric === 'DISTANCE_M') return `${km(v)} km`;
  if (metric === 'MOVING_SECONDS') return formatDuration(v);
  if (metric === 'ACTIVE_DAYS') return `${v} day${v === 1 ? '' : 's'}`;
  return `${v} activit${v === 1 ? 'y' : 'ies'}`;
}
