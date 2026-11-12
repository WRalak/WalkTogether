import { useState } from 'react';
import { CLUB_CATEGORIES, CLUB_VISIBILITY } from '@walktogether/shared-types';
import { createClubSchema, updateClubSchema } from '@walktogether/validation';
import { Button, TextField } from '@/components/ui';
import { Chips, Notice, Toggle } from '@/components/admin';
import { categoryLabel } from '@/utils/format';
import { errorMessage } from '@/utils/errors';

export interface ClubFormValues {
  name: string;
  slug: string;
  description: string;
  category: (typeof CLUB_CATEGORIES)[number];
  visibility: (typeof CLUB_VISIBILITY)[number];
  requiresApproval: boolean;
  city: string;
  countryCode: string;
  websiteUrl: string;
  contactEmail: string;
}

const VISIBILITY: Record<(typeof CLUB_VISIBILITY)[number], string> = { PUBLIC: 'Public', PRIVATE: 'Private', INVITE_ONLY: 'Invite only' };
const VISIBILITY_HINT: Record<(typeof CLUB_VISIBILITY)[number], string> = {
  PUBLIC: 'Anyone can find and join.',
  PRIVATE: 'Discoverable; join requests are reviewed by admins.',
  INVITE_ONLY: 'Hidden; joining requires an invitation.',
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
const blank = (s: string) => (s.trim() ? s.trim() : null);

/** Builds the API payload; validated with the same Zod schemas the server uses. */
function toPayload(v: ClubFormValues, mode: 'create' | 'update') {
  const base = {
    name: v.name.trim(),
    description: blank(v.description),
    category: v.category,
    visibility: v.visibility,
    requiresApproval: v.visibility === 'PUBLIC' ? v.requiresApproval : true,
    city: blank(v.city),
    countryCode: blank(v.countryCode.toUpperCase()),
    websiteUrl: blank(v.websiteUrl),
    contactEmail: blank(v.contactEmail),
  };
  return mode === 'create' ? createClubSchema.safeParse({ ...base, slug: v.slug }) : updateClubSchema.safeParse(base);
}

export function ClubForm({
  initial,
  mode,
  submitLabel,
  onSubmit,
}: {
  initial?: Partial<ClubFormValues>;
  mode: 'create' | 'update';
  submitLabel: string;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [v, setV] = useState<ClubFormValues>({
    name: '',
    slug: '',
    description: '',
    category: 'WALKING',
    visibility: 'PUBLIC',
    requiresApproval: false,
    city: '',
    countryCode: 'KE',
    websiteUrl: '',
    contactEmail: '',
    ...initial,
  });
  const [slugEdited, setSlugEdited] = useState(mode === 'update');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof ClubFormValues>(k: K, val: ClubFormValues[K]) => setV((p) => ({ ...p, [k]: val }));

  const submit = async () => {
    setFormError(null);
    const parsed = toPayload(v, mode);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(parsed.data as Record<string, unknown>);
    } catch (e) {
      setFormError(errorMessage(e, 'Could not save the club.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {formError ? <Notice>{formError}</Notice> : null}
      <TextField
        label="Club name"
        value={v.name}
        error={errors.name}
        onChangeText={(t) => {
          set('name', t);
          if (!slugEdited) set('slug', slugify(t));
        }}
      />
      {mode === 'create' && (
        <TextField
          label="Club link"
          value={v.slug}
          autoCapitalize="none"
          error={errors.slug}
          hint="Lowercase letters, numbers and dashes. It can’t be changed later."
          onChangeText={(t) => {
            setSlugEdited(true);
            set('slug', t);
          }}
        />
      )}
      <TextField
        label="Description"
        value={v.description}
        multiline
        numberOfLines={4}
        error={errors.description}
        onChangeText={(t) => set('description', t)}
        style={{ minHeight: 100, textAlignVertical: 'top' }}
      />
      <Chips label="Category" value={v.category} options={CLUB_CATEGORIES.map((c) => ({ key: c, label: categoryLabel(c) }))} onChange={(c) => set('category', c)} />
      <Chips label="Visibility" value={v.visibility} options={CLUB_VISIBILITY.map((c) => ({ key: c, label: VISIBILITY[c] }))} onChange={(c) => set('visibility', c)} />
      <Notice tone="info">{VISIBILITY_HINT[v.visibility]}</Notice>
      {v.visibility === 'PUBLIC' && (
        <Toggle label="Approve new members" hint="New members wait for an admin to approve them." value={v.requiresApproval} onChange={(b) => set('requiresApproval', b)} />
      )}
      <TextField label="City / area" value={v.city} error={errors.city} onChangeText={(t) => set('city', t)} />
      <TextField
        label="Country code"
        value={v.countryCode}
        maxLength={2}
        autoCapitalize="characters"
        error={errors.countryCode}
        hint="Two letters, e.g. KE"
        onChangeText={(t) => set('countryCode', t)}
      />
      <TextField
        label="Website"
        value={v.websiteUrl}
        keyboardType="url"
        autoCapitalize="none"
        placeholder="https://"
        error={errors.websiteUrl}
        onChangeText={(t) => set('websiteUrl', t)}
      />
      <TextField
        label="Contact email"
        value={v.contactEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        error={errors.contactEmail}
        onChangeText={(t) => set('contactEmail', t)}
      />
      <Button title={submitLabel} loading={busy} onPress={() => void submit()} />
    </>
  );
}
