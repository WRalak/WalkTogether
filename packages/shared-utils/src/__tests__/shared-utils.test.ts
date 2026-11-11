import { describe, expect, it } from 'vitest';
import { activityTypeLabel, categoryLabel, formatDuration, formatKm, formatMoney, formatMoneyMap, formatPace, initials, timeAgo } from '../format';

describe('shared-utils', () => {
  it('formats money from minor units', () => {
    expect(formatMoney(150000, 'KES')).toBe('KES 1,500');
    expect(formatMoney(150050, 'KES', { decimals: true })).toBe('KES 1,500.50');
    expect(formatMoneyMap({ KES: 150000, USD: 2000 })).toBe('KES 1,500 · USD 20');
    expect(formatMoneyMap({})).toBe('—');
  });
  it('formats distances, durations and paces', () => {
    expect(formatKm(3456)).toBe('3.46');
    expect(formatKm(12345)).toBe('12.3');
    expect(formatDuration(3909)).toBe('1:05:09');
    expect(formatDuration(309)).toBe('5:09');
    expect(formatPace(365)).toBe('6:05');
    expect(formatPace(null)).toBe('--:--');
  });
  it('labels and initials', () => {
    expect(initials('Nairobi Sunrise Walkers')).toBe('NS');
    expect(initials('Amina')).toBe('AM');
    expect(categoryLabel('SCHOOL_UNIVERSITY')).toBe('School / university');
    expect(activityTypeLabel('RUN')).toBe('Run');
  });
  it('relative time', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(timeAgo('2026-01-01T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-01-01T11:55:00Z', now)).toBe('5m');
    expect(timeAgo('2026-01-01T09:00:00Z', now)).toBe('3h');
  });
});
