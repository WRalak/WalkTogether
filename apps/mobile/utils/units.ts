import { formatDuration, formatPace } from '@walktogether/gps';

export const km = (m: number) => (m / 1000).toFixed(m < 10_000 ? 2 : 1);
export { formatDuration, formatPace };
export const typeLabel = (t: string) => (t === 'RUN' ? 'Run' : t === 'HIKE' ? 'Hike' : 'Walk');
