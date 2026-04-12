import { useState } from 'react';
import {
  Layout,
  Clock,
  Sparkles,
  GripVertical,
  RefreshCw,
  BookmarkPlus,
  Github,
  Heart,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SignInModal } from '@/components/auth/SignInModal';

const GITHUB_URL = import.meta.env.VITE_GITHUB_REPO_URL ?? 'https://github.com';

const features = [
  {
    icon: Layout,
    title: 'Kanban Boards',
    description: 'Organize work into columns and cards with full drag-and-drop support.',
  },
  {
    icon: Clock,
    title: 'Timeline / Gantt View',
    description: 'Visualize card due dates across a scrollable timeline.',
  },
  {
    icon: Sparkles,
    title: 'AI Assistant',
    description: 'Use natural language to create, move, and manage cards instantly.',
  },
  {
    icon: GripVertical,
    title: 'Drag & Drop',
    description: 'Reorder cards and columns with smooth, accessible drag-and-drop.',
  },
  {
    icon: RefreshCw,
    title: 'Real-time Sync',
    description: 'Changes appear instantly across all your devices and collaborators.',
  },
  {
    icon: BookmarkPlus,
    title: 'Card Templates',
    description: 'Save any card as a reusable template to speed up recurring workflows.',
  },
];

const freePlanFeatures = [
  'Unlimited boards, columns & cards',
  'Drag & drop reordering',
  'Timeline / Gantt view',
  'Card templates',
  'Real-time sync',
  'Open source & self-hostable',
];

export function LandingPage() {
  const [isSignInModalOpen, setIsSignInModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#0B0F0F] text-[#F2F7F7]">
      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center overflow-hidden px-6 py-28 text-center md:py-36 lg:py-44">
        {/* Background decorative orbs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-[#78fcd6]/10 blur-[120px] animate-float" />
          <div className="absolute -bottom-20 -right-20 h-[300px] w-[300px] rounded-full bg-[#00ffb6]/8 blur-[100px]" />
        </div>

        {/* Badge */}
        <div className="relative mb-6 inline-flex items-center gap-2 rounded-full border border-[#78fcd6]/30 bg-[#78fcd6]/10 px-4 py-1.5 text-sm font-medium text-[#78fcd6] backdrop-blur-sm">
          <Sparkles className="w-4 h-4" />
          Open Source Kanban Board
        </div>

        {/* Headline */}
        <h1 className="relative mb-6 max-w-3xl text-5xl font-black tracking-tight sm:text-6xl lg:text-7xl leading-[1.1]">
          Organize your work with{' '}
          <span className="gradient-cyan-text">ZeroBoard</span>
        </h1>

        {/* Description */}
        <p className="relative mb-10 max-w-2xl text-lg text-[#A8B2B2] leading-relaxed md:text-xl">
          A powerful, open-source Kanban board with timeline views, AI assistance,
          real-time sync, and deep customization — built for people who want more
          control of their workflow tooling.
        </p>

        {/* CTAs */}
        <div className="relative flex flex-wrap items-center justify-center gap-4">
          <Button
            onClick={() => setIsSignInModalOpen(true)}
            className="h-12 px-8 bg-gradient-to-r from-[#78fcd6] to-[#00ffb6] text-[#0B0F0F] font-bold rounded-full text-base shadow-lg ring-2 ring-[#78fcd6]/30 hover:shadow-[#78fcd6]/50 hover:scale-105 transition-all duration-300"
          >
            Get Started — It's Free
          </Button>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 h-12 px-8 bg-white/5 hover:bg-white/10 border border-[#78fcd6]/30 hover:border-[#78fcd6]/50 rounded-full text-[#F2F7F7] text-base font-medium transition-all duration-300 hover:shadow-lg hover:shadow-[#78fcd6]/20"
          >
            <Github className="w-5 h-5" />
            View on GitHub
          </a>
        </div>
      </section>

      {/* Trello Tribute */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-2xl bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-8 text-center">
          <div className="mb-3 flex justify-center">
            <Heart className="w-6 h-6 text-[#78fcd6]" />
          </div>
          <h2 className="mb-4 text-2xl font-bold text-[#F2F7F7]">
            Born from Love for Trello
          </h2>
          <p className="text-[#A8B2B2] leading-relaxed">
            We're huge fans of Trello. Some of us have used it for over 15 years to
            track daily activities, work routines, food habits, sleep schedules, and
            more. We simply wanted more customization and control of our tooling.
          </p>
        </div>
      </section>

      {/* Feature Showcase */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-center text-3xl font-bold text-[#F2F7F7]">
            Everything you need, nothing you don't
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#78fcd6]/10">
                  <Icon className="w-5 h-5 text-[#78fcd6]" />
                </div>
                <h3 className="mb-2 font-semibold text-[#F2F7F7]">{title}</h3>
                <p className="text-sm text-[#A8B2B2] leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-10 text-center text-3xl font-bold text-[#F2F7F7]">
            Simple pricing
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Free plan */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 flex flex-col">
              <h3 className="mb-1 text-xl font-bold text-[#F2F7F7]">Free</h3>
              <p className="mb-6 text-3xl font-black text-[#F2F7F7]">
                $0
                <span className="text-base font-normal text-[#A8B2B2]">/forever</span>
              </p>
              <ul className="space-y-2.5 flex-1">
                {freePlanFeatures.map((feat) => (
                  <li key={feat} className="flex items-start gap-2.5 text-sm text-[#A8B2B2]">
                    <span className="mt-0.5 text-[#78fcd6]">✓</span>
                    {feat}
                  </li>
                ))}
              </ul>
              <Button
                onClick={() => setIsSignInModalOpen(true)}
                className="mt-8 w-full h-11 bg-white/10 hover:bg-white/15 text-[#F2F7F7] border border-white/10 rounded-xl font-semibold transition-all duration-300"
              >
                Get Started Free
              </Button>
            </div>

            {/* AI Pro plan — highlighted */}
            <div className="relative bg-white/5 backdrop-blur-md border border-[#78fcd6]/40 rounded-2xl p-6 flex flex-col shadow-lg shadow-[#78fcd6]/10 ring-1 ring-[#78fcd6]/20">
              <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl gradient-cyan" />
              <div className="mb-2 inline-flex self-start items-center gap-1.5 rounded-full bg-[#78fcd6]/10 px-3 py-0.5 text-xs font-semibold text-[#78fcd6]">
                <Sparkles className="w-3 h-3" />
                Best Value
              </div>
              <h3 className="mb-1 text-xl font-bold text-[#F2F7F7]">AI Pro</h3>
              <p className="mb-1 text-3xl font-black text-[#78fcd6]">
                $3
                <span className="text-base font-normal text-[#A8B2B2]">/month</span>
              </p>
              <p className="mb-6 text-sm text-[#A8B2B2]">Less than a coffee. Everything in Free, plus:</p>
              <ul className="space-y-2.5 flex-1">
                <li className="flex items-start gap-2.5 text-sm text-[#A8B2B2]">
                  <span className="mt-0.5 text-[#78fcd6]">✓</span>
                  AI Assistant — manage your board with plain English
                </li>
                <li className="flex items-start gap-2.5 text-sm text-[#A8B2B2]">
                  <span className="mt-0.5 text-[#78fcd6]">✓</span>
                  Create, move, and edit cards in seconds
                </li>
                <li className="flex items-start gap-2.5 text-sm text-[#A8B2B2]">
                  <span className="mt-0.5 text-[#78fcd6]">✓</span>
                  Priority support &amp; early access to new features
                </li>
              </ul>
              <Button
                onClick={() => setIsSignInModalOpen(true)}
                className="mt-8 w-full h-11 bg-gradient-to-r from-[#78fcd6] to-[#00ffb6] text-[#0B0F0F] font-bold rounded-xl hover:shadow-lg hover:shadow-[#78fcd6]/30 hover:scale-[1.02] transition-all duration-300"
              >
                Start 7-Day Free Trial
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Open Source */}
      <section className="px-6 pb-24">
        <div className="mx-auto max-w-3xl bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-8 text-center">
          <Github className="mx-auto mb-4 w-8 h-8 text-[#78fcd6]" />
          <h2 className="mb-3 text-2xl font-bold text-[#F2F7F7]">
            Proudly Open Source
          </h2>
          <p className="mb-6 text-[#A8B2B2] leading-relaxed">
            ZeroBoard is fully open source. Read the code, fork it, self-host it, or
            contribute back. The community is what makes this project great.
          </p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 h-11 px-6 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[#F2F7F7] font-medium transition-colors"
          >
            <Github className="w-4 h-4" />
            View on GitHub
          </a>
        </div>
      </section>

      <SignInModal isOpen={isSignInModalOpen} onOpenChange={setIsSignInModalOpen} />
    </div>
  );
}
