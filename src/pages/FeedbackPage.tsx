import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { SignInModal } from '@/components/auth/SignInModal';

// ─── Schema ────────────────────────────────────────────────────────────────────

const feedbackSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  category: z.enum(['Feature Request', 'Bug Report', 'Improvement', 'Integration', 'Other']),
});

type FeedbackFormValues = z.infer<typeof feedbackSchema>;

// ─── Pipeline step data ─────────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { n: 1, label: 'You submit a feature request' },
  { n: 2, label: 'A GitHub issue is created automatically' },
  { n: 3, label: 'An AI Agent picks it up and begins working immediately' },
  { n: 4, label: 'Project owners and contributors review the AI\'s PR' },
  { n: 5, label: 'AI iterates based on PR feedback' },
  { n: 6, label: 'Feature is approved and shipped' },
];

// ─── Component ──────────────────────────────────────────────────────────────────

export function FeedbackPage() {
  const { isSignedIn, session } = useAuthContext();
  const [isSignInModalOpen, setIsSignInModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FeedbackFormValues>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: {
      title: '',
      description: '',
      category: 'Feature Request',
    },
  });

  const categoryValue = watch('category');

  const onSubmit = async (data: FeedbackFormValues) => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? 'Failed to submit feedback');
      }

      reset();
      setIsSubmitted(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F0F] text-[#F2F7F7] px-6 py-16">
      <div className="mx-auto max-w-3xl space-y-12">

        {/* Section A: Pipeline explanation */}
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-8">
          <h2 className="mb-2 text-2xl font-bold text-[#F2F7F7]">How Feature Requests Work</h2>
          <p className="mb-8 text-[#A8B2B2] leading-relaxed">
            We genuinely encourage you to submit feature requests. You might be surprised how quickly
            they get built.
          </p>

          <ol className="relative space-y-0">
            {PIPELINE_STEPS.map((step, idx) => {
              const isLast = idx === PIPELINE_STEPS.length - 1;
              return (
                <li key={step.n} className="flex gap-4">
                  {/* Connector column */}
                  <div className="flex flex-col items-center">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#78fcd6]/15 border border-[#78fcd6]/40 text-[#78fcd6] text-sm font-bold">
                      {step.n}
                    </div>
                    {!isLast && (
                      <div className="w-px flex-1 bg-[#78fcd6]/20 my-1" style={{ minHeight: '1.5rem' }} />
                    )}
                  </div>
                  {/* Label */}
                  <p className={`pt-1 text-sm leading-relaxed ${isLast ? 'pb-0' : 'pb-5'} text-[#A8B2B2]`}>
                    {step.label}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Section B: Feedback form */}
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-8">
          <h2 className="mb-6 text-2xl font-bold text-[#F2F7F7]">Submit a Feature Request</h2>

          {isSubmitted ? (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#78fcd6]/15 border border-[#78fcd6]/40">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-[#78fcd6]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-[#F2F7F7]">Thank you!</h3>
              <p className="text-[#A8B2B2] max-w-md">
                Your feedback has been submitted. We appreciate you helping make ZeroBoard better.
              </p>
              <Button
                onClick={() => setIsSubmitted(false)}
                variant="outline"
                className="mt-2 border-white/10 text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5"
              >
                Submit another
              </Button>
            </div>
          ) : !isSignedIn ? (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <p className="text-[#A8B2B2]">Please sign in to submit feedback.</p>
              <Button
                onClick={() => setIsSignInModalOpen(true)}
                className="h-11 px-8 gradient-cyan text-[#0B0F0F] font-bold rounded-xl hover:opacity-90"
              >
                Sign In
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="fb-title" className="text-sm text-[#A8B2B2]">
                  Title <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="fb-title"
                  placeholder="Short, descriptive title"
                  className="bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
                  {...register('title')}
                />
                {errors.title && (
                  <p className="text-xs text-red-400">{errors.title.message}</p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="fb-description" className="text-sm text-[#A8B2B2]">
                  Description <span className="text-red-400">*</span>
                </Label>
                <textarea
                  id="fb-description"
                  rows={5}
                  placeholder="Describe the feature or issue in detail..."
                  className="w-full rounded-md bg-white/5 border border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50 px-3 py-2 text-sm resize-y outline-none focus-visible:ring-2 focus-visible:ring-[#78fcd6]/40 focus-visible:border-[#78fcd6]/40 transition-[border,box-shadow]"
                  {...register('description')}
                />
                {errors.description && (
                  <p className="text-xs text-red-400">{errors.description.message}</p>
                )}
              </div>

              {/* Category */}
              <div className="space-y-2">
                <Label htmlFor="fb-category" className="text-sm text-[#A8B2B2]">
                  Category
                </Label>
                <Select
                  value={categoryValue}
                  onValueChange={(val) =>
                    setValue('category', val as FeedbackFormValues['category'], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger
                    id="fb-category"
                    className="w-full bg-white/5 border-white/10 text-[#F2F7F7]"
                  >
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#111515] border-white/10 text-[#F2F7F7]">
                    <SelectItem value="Feature Request">Feature Request</SelectItem>
                    <SelectItem value="Bug Report">Bug Report</SelectItem>
                    <SelectItem value="Improvement">Improvement</SelectItem>
                    <SelectItem value="Integration">Integration</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
                {errors.category && (
                  <p className="text-xs text-red-400">{errors.category.message}</p>
                )}
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-11 gradient-cyan text-[#0B0F0F] font-bold rounded-xl hover:opacity-90 disabled:opacity-50"
              >
                {isSubmitting ? 'Submitting…' : 'Submit Feedback'}
              </Button>
            </form>
          )}
        </div>
      </div>

      <SignInModal isOpen={isSignInModalOpen} onOpenChange={setIsSignInModalOpen} />
    </div>
  );
}
