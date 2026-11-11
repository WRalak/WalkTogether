export { categoryLabel, formatKm, initials } from '@walktogether/shared-utils';

const EVENT_TYPE_LABELS: Record<string, string> = {
  WALK: 'Group walk',
  RUN: 'Group run',
  HIKE: 'Hike',
  CHARITY_WALK: 'Charity walk',
  FITNESS: 'Fitness session',
  SOCIAL: 'Social',
};

export const eventTypeLabel = (t: string) => EVENT_TYPE_LABELS[t] ?? t;
export const EVENT_TYPE_OPTIONS = Object.keys(EVENT_TYPE_LABELS);

/** Event times are shown in the event's own timezone (e.g. Africa/Nairobi), not the server's. */
export function formatEventDate(iso: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en-KE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
  } catch {
    return new Date(iso).toUTCString();
  }
}
