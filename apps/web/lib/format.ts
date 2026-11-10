export function categoryLabel(c: string) {
  const map: Record<string, string> = {
    WALKING: 'Walking',
    RUNNING: 'Running',
    HIKING: 'Hiking',
    MIXED_FITNESS: 'Mixed fitness',
    CORPORATE_WELLNESS: 'Corporate wellness',
    CHARITY: 'Charity',
    SCHOOL_UNIVERSITY: 'School / university',
    OTHER: 'Other',
  };
  return map[c] ?? c;
}

/** "Nairobi Sunrise Walkers" -> "NS" */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase();
}
