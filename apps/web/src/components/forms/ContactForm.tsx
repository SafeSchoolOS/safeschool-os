'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const contactSchema = z.object({
  type: z.enum(['school', 'manufacturer', 'integrator', 'other']),
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Valid email required'),
  organization: z.string().min(1, 'Organization is required'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
});

type ContactFormData = z.infer<typeof contactSchema>;

export function ContactForm() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: { type: 'school' },
  });

  const onSubmit = async (data: ContactFormData) => {
    try {
      setError('');
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to send');
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again or email partners@safeschool.org directly.');
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl text-teal-500">&#10003;</span>
        </div>
        <h3 className="text-xl font-bold text-navy-700 mb-2">Message Sent!</h3>
        <p className="text-slate-600">We&apos;ll get back to you within 24 hours.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">I am a:</label>
        <div className="flex flex-wrap gap-3">
          {(['school', 'manufacturer', 'integrator', 'other'] as const).map((t) => (
            <label key={t} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value={t} {...register('type')} className="accent-teal-500" />
              <span className="text-sm text-slate-700 capitalize">
                {t === 'school' ? 'School Administrator' : t === 'other' ? 'Other' : t.charAt(0).toUpperCase() + t.slice(1)}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
        <input
          {...register('name')}
          className={cn(
            'w-full px-4 py-2.5 border rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500',
            errors.name ? 'border-danger' : 'border-slate-200',
          )}
        />
        {errors.name && <p className="text-xs text-danger mt-1">{errors.name.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
        <input
          type="email"
          {...register('email')}
          className={cn(
            'w-full px-4 py-2.5 border rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500',
            errors.email ? 'border-danger' : 'border-slate-200',
          )}
        />
        {errors.email && <p className="text-xs text-danger mt-1">{errors.email.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Organization</label>
        <input
          {...register('organization')}
          className={cn(
            'w-full px-4 py-2.5 border rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500',
            errors.organization ? 'border-danger' : 'border-slate-200',
          )}
        />
        {errors.organization && <p className="text-xs text-danger mt-1">{errors.organization.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
        <textarea
          rows={5}
          {...register('message')}
          className={cn(
            'w-full px-4 py-2.5 border rounded-button text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 resize-y',
            errors.message ? 'border-danger' : 'border-slate-200',
          )}
        />
        {errors.message && <p className="text-xs text-danger mt-1">{errors.message.message}</p>}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full py-3 bg-teal-500 text-white font-semibold rounded-button hover:bg-teal-600 transition-colors disabled:opacity-50"
      >
        {isSubmitting ? 'Sending...' : 'Send Message'}
      </button>
    </form>
  );
}
