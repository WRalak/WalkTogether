'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CLUB_CATEGORIES, CLUB_VISIBILITY } from '@walktogether/shared-types';
import { clubSlugSchema, countryCodeSchema, emailSchema, urlSchema } from '@walktogether/validation';
import { Button, Field, Input, Select, Textarea } from '@walktogether/ui';

const optional = <T extends z.ZodTypeAny>(s: T) => z.union([s, z.literal('')]).optional();

export const clubFormSchema = z.object({
  name: z.string().trim().min(3, 'At least 3 characters').max(80),
  slug: clubSlugSchema,
  description: z.string().trim().max(2000).optional(),
  category: z.enum(CLUB_CATEGORIES),
  visibility: z.enum(CLUB_VISIBILITY),
  requiresApproval: z.boolean(),
  city: z.string().trim().max(100).optional(),
  countryCode: optional(countryCodeSchema),
  websiteUrl: optional(urlSchema),
  contactEmail: optional(emailSchema),
  logoUrl: optional(urlSchema),
  coverUrl: optional(urlSchema),
});
export type ClubFormValues = z.infer<typeof clubFormSchema>;

const CATEGORY_LABELS: Record<string, string> = {
  WALKING: 'Walking', RUNNING: 'Running', HIKING: 'Hiking', MIXED_FITNESS: 'Mixed fitness', CORPORATE_WELLNESS: 'Corporate wellness', CHARITY: 'Charity', SCHOOL_UNIVERSITY: 'School / university', OTHER: 'Other',
};
const VISIBILITY_LABELS: Record<string, string> = {
  PUBLIC: 'Public: anyone can find and join',
  PRIVATE: 'Private: discoverable, join requests are reviewed',
  INVITE_ONLY: 'Invite-only: hidden, joining requires an invitation',
};

/** Converts empty strings to null so optional fields can be cleared. */
export function toClubPayload(v: ClubFormValues) {
  const blank = (s?: string) => (s && s.length ? s : null);
  return {
    name: v.name,
    description: blank(v.description),
    category: v.category,
    visibility: v.visibility,
    requiresApproval: v.requiresApproval,
    city: blank(v.city),
    countryCode: blank(v.countryCode),
    websiteUrl: blank(v.websiteUrl),
    contactEmail: blank(v.contactEmail),
    logoUrl: blank(v.logoUrl),
    coverUrl: blank(v.coverUrl),
  };
}

export function ClubForm({ defaultValues, submitLabel, slugLocked, onSubmit }: { defaultValues?: Partial<ClubFormValues>; submitLabel: string; slugLocked?: boolean; onSubmit: (v: ClubFormValues) => Promise<void> }) {
  const { register, handleSubmit, formState, setValue, watch } = useForm<ClubFormValues>({
    resolver: zodResolver(clubFormSchema),
    defaultValues: { category: 'WALKING', visibility: 'PUBLIC', requiresApproval: false, countryCode: 'KE', ...defaultValues },
  });
  const e = formState.errors;
  const visibility = watch('visibility');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div className="grid gap-5 md:grid-cols-2">
        <Field id="name" label="Club name" error={e.name?.message}>
          <Input
            {...register('name', {
              onChange: (ev: React.ChangeEvent<HTMLInputElement>) => {
                if (!slugLocked && !formState.dirtyFields.slug) {
                  setValue('slug', ev.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50));
                }
              },
            })}
          />
        </Field>
        <Field id="slug" label="Club URL" error={e.slug?.message} hint={slugLocked ? 'The club URL cannot be changed.' : 'walktogether.app/clubs/your-club'}>
          <Input disabled={slugLocked} {...register('slug')} />
        </Field>
      </div>
      <Field id="description" label="Description" error={e.description?.message}>
        <Textarea rows={4} {...register('description')} />
      </Field>
      <div className="grid gap-5 md:grid-cols-2">
        <Field id="category" label="Category" error={e.category?.message}>
          <Select {...register('category')}>
            {CLUB_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="visibility" label="Visibility" error={e.visibility?.message}>
          <Select {...register('visibility')}>
            {CLUB_VISIBILITY.map((v) => (
              <option key={v} value={v}>
                {VISIBILITY_LABELS[v]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {visibility === 'PUBLIC' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" {...register('requiresApproval')} />
          Require admin approval for new members
        </label>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Field id="city" label="City / area" error={e.city?.message}>
          <Input {...register('city')} />
        </Field>
        <Field id="countryCode" label="Country code" error={e.countryCode?.message} hint="Two letters, e.g. KE">
          <Input maxLength={2} {...register('countryCode')} />
        </Field>
        <Field id="websiteUrl" label="Website" error={e.websiteUrl?.message}>
          <Input type="url" placeholder="https://" {...register('websiteUrl')} />
        </Field>
        <Field id="contactEmail" label="Contact email" error={e.contactEmail?.message}>
          <Input type="email" {...register('contactEmail')} />
        </Field>
        <Field id="logoUrl" label="Logo image URL" error={e.logoUrl?.message} hint="Image uploads arrive with media management.">
          <Input type="url" placeholder="https://" {...register('logoUrl')} />
        </Field>
        <Field id="coverUrl" label="Cover image URL" error={e.coverUrl?.message}>
          <Input type="url" placeholder="https://" {...register('coverUrl')} />
        </Field>
      </div>
      <Button type="submit" loading={formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
