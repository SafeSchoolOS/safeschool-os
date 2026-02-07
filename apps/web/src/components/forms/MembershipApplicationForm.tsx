'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const membershipSchema = z.object({
  companyName: z.string().min(2, 'Company name is required'),
  contactName: z.string().min(2, 'Contact name is required'),
  title: z.string().min(2, 'Title is required'),
  email: z.string().email('Valid email required'),
  phone: z.string().optional(),
  website: z.string().url('Valid URL required').optional().or(z.literal('')),
  productCategories: z.array(z.string()).min(1, 'Select at least one category'),
  interestedTier: z.enum(['platinum', 'gold', 'silver', 'not-sure']),
  howHeard: z.string().optional(),
  notes: z.string().optional(),
});

type MembershipFormData = z.infer<typeof membershipSchema>;

const productCategoryOptions = [
  'Readers', 'Panels', 'Panic Buttons', 'Cameras', 'Intercoms', 'Gateways', 'Other',
];

export function MembershipApplicationForm() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MembershipFormData>({
    resolver: zodResolver(membershipSchema),
    defaultValues: { productCategories: [], interestedTier: 'not-sure' },
  });

  const onSubmit = async (data: MembershipFormData) => {
    try {
      setError('');
      const res = await fetch('/api/membership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to submit');
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again or email partners@safeschool.org.');
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl text-teal-500">&#10003;</span>
        </div>
        <h3 className="text-xl font-bold text-navy-700 mb-2">Application Submitted!</h3>
        <p className="text-slate-600">We&apos;ll review your application and be in touch within 48 hours.</p>
      </div>
    );
  }

  const inputClass = (hasError: boolean) =>
    cn(
      'w-full px-4 py-2.5 border rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500',
      hasError ? 'border-danger' : 'border-slate-200',
    );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Company Name *</label>
          <input {...register('companyName')} className={inputClass(!!errors.companyName)} />
          {errors.companyName && <p className="text-xs text-danger mt-1">{errors.companyName.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Contact Name *</label>
          <input {...register('contactName')} className={inputClass(!!errors.contactName)} />
          {errors.contactName && <p className="text-xs text-danger mt-1">{errors.contactName.message}</p>}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
          <input {...register('title')} className={inputClass(!!errors.title)} />
          {errors.title && <p className="text-xs text-danger mt-1">{errors.title.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
          <input type="email" {...register('email')} className={inputClass(!!errors.email)} />
          {errors.email && <p className="text-xs text-danger mt-1">{errors.email.message}</p>}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
          <input type="tel" {...register('phone')} className={inputClass(false)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Website</label>
          <input type="url" {...register('website')} placeholder="https://" className={inputClass(!!errors.website)} />
          {errors.website && <p className="text-xs text-danger mt-1">{errors.website.message}</p>}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Product Categories *</label>
        <div className="flex flex-wrap gap-3">
          {productCategoryOptions.map((cat) => (
            <label key={cat} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" value={cat} {...register('productCategories')} className="accent-teal-500" />
              <span className="text-sm text-slate-700">{cat}</span>
            </label>
          ))}
        </div>
        {errors.productCategories && (
          <p className="text-xs text-danger mt-1">{errors.productCategories.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Interested Tier</label>
        <div className="flex flex-wrap gap-3">
          {([
            { value: 'platinum', label: 'Platinum ($25K/yr)' },
            { value: 'gold', label: 'Gold ($15K/yr)' },
            { value: 'silver', label: 'Silver ($5K/yr)' },
            { value: 'not-sure', label: 'Not Sure Yet' },
          ] as const).map((tier) => (
            <label key={tier.value} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value={tier.value} {...register('interestedTier')} className="accent-teal-500" />
              <span className="text-sm text-slate-700">{tier.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">How did you hear about us?</label>
        <input {...register('howHeard')} className={inputClass(false)} />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Additional Notes</label>
        <textarea rows={4} {...register('notes')} className={cn(inputClass(false), 'resize-y')} />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full py-3 bg-teal-500 text-white font-semibold rounded-button hover:bg-teal-600 transition-colors disabled:opacity-50"
      >
        {isSubmitting ? 'Submitting...' : 'Submit Application'}
      </button>
    </form>
  );
}
