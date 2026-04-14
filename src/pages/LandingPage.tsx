import { useState } from 'react';
import {
  Sparkles,
  Github,
  Heart,
  Check,
  ArrowRight,
  Layout,
  Clock,
  Wand2,
  GripVertical,
  RefreshCw,
  BookmarkPlus,
  Share2,
  Download,
  Palette,
  Lock,
  Rocket,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SignInModal } from '@/components/auth/SignInModal';

const GITHUB_URL = import.meta.env.VITE_GITHUB_REPO_URL ?? 'https://github.com';

type WideBlock = {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  image: string;
  imageAlt: string;
};

type TallBlock = {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  image: string;
  imageAlt: string;
  reverse?: boolean;
};

const timelineBlock: WideBlock = {
  eyebrow: 'Timeline / Gantt',
  title: 'See the whole quarter at a glance',
  description:
    'Switch to a Gantt-style timeline to spot overlapping deadlines, scheduling gaps, and the path to launch — without leaving your board.',
  bullets: [
    'Scrollable timeline of every due date',
    'Color-coded by column and status',
    'One click back to kanban view',
  ],
  image: '/screenshots/timeline.png',
  imageAlt: 'ZeroBoard timeline and Gantt chart view of cards across dates',
};

const tallBlocks: TallBlock[] = [
  {
    eyebrow: 'AI Assistant',
    title: 'Just tell it what you want',
    description:
      'Skip the clicks. Type "move all overdue cards to In Progress" or "add a checklist for launch tasks" — the AI assistant handles the rest.',
    bullets: [
      'Natural-language card creation & moves',
      'Bulk edits in seconds, not minutes',
      'Lives right in your board sidebar',
    ],
    image: '/screenshots/ai-assist.png',
    imageAlt: 'ZeroBoard AI assistant chat sidebar managing cards with plain English',
  },
  {
    eyebrow: 'Card Editor',
    title: 'Every card, infinitely deep',
    description:
      'Checklists, attachments, rich descriptions, due dates, labels, and activity logs — all in a focused editor that stays out of your way.',
    bullets: [
      'Checklists, images, and rich text',
      'Attach covers & target dates',
      'Full activity feed on every change',
    ],
    image: '/screenshots/card-editor.png',
    imageAlt: 'ZeroBoard card editor with labels, cover images, checklists, and activity',
    reverse: true,
  },
];

const bentoFeatures = [
  {
    icon: Share2,
    title: 'Share & Collaborate',
    description:
      'Invite teammates via email with view or edit access. Changes sync in real time across every device.',
    image: '/screenshots/sharing.png',
  },
  {
    icon: BookmarkPlus,
    title: 'Save as Template',
    description:
      'Turn any board or card into a reusable template and spin up new boards from it in a single click.',
    image: '/screenshots/save-as-template.png',
  },
  {
    icon: Palette,
    title: 'Custom Backgrounds',
    description:
      'Personalize each board with a gradient or solid color — pick from curated presets or go custom.',
    image: '/screenshots/choose-background-color.png',
  },
  {
    icon: Download,
    title: 'Export to JSON',
    description:
      'Own your data. Export any board to JSON for backup, migration, or piping into your own tooling.',
    image: '/screenshots/export-to-json.png',
  },
  {
    icon: Lock,
    title: 'Google OAuth + Email',
    description:
      'Sign in with Google or email/password via Supabase Auth. Boards sync across devices instantly.',
    image: '/screenshots/sign-in-auth.png',
  },
  {
    icon: Rocket,
    title: 'Deploy on Vercel',
    description:
      'One-click deploy from GitHub. Serverless API routes keep your Supabase and AI keys safe on the server.',
    image: '/screenshots/deploy-with-vercel.png',
  },
];

const quickFeatures = [
  { icon: Layout, label: 'Kanban Boards' },
  { icon: Clock, label: 'Timeline / Gantt' },
  { icon: Wand2, label: 'AI Assistant' },
  { icon: GripVertical, label: 'Drag & Drop' },
  { icon: RefreshCw, label: 'Real-time Sync' },
  { icon: Pencil, label: 'Card Editor' },
];

const freePlanFeatures = [
  'Unlimited boards, columns & cards',
  'Drag & drop reordering',
  'Timeline / Gantt view',
  'Card templates',
  'Real-time sync',
  'Open source & self-hostable',
];

function BrowserFrame({
  src,
  alt,
  ariaLabel,
  imgClassName,
}: {
  src: string;
  alt: string;
  ariaLabel?: string;
  imgClassName?: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0E1414] shadow-2xl shadow-black/60"
    >
      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-white/5 bg-[#0B0F0F] px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]/80" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]/80" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]/80" />
        <div className="ml-3 hidden flex-1 items-center gap-2 rounded-md bg-white/5 px-3 py-1 text-xs text-[#A8B2B2] sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-[#78fcd6]" />
          board.zeroclickdev.ai
        </div>
      </div>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={imgClassName ?? 'block h-auto w-full'}
      />
    </div>
  );
}

function ScreenshotFrame({
  src,
  alt,
  className,
  eager = false,
}: {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-8 -z-10">
        <div className="absolute inset-0 rounded-full bg-[#78fcd6]/15 blur-[100px]" />
      </div>
      <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-[#78fcd6]/40 via-transparent to-[#00ffb6]/20 opacity-60 blur-sm" />
      <BrowserFrame src={src} alt={alt} imgClassName={className} ariaLabel={alt} />
      {eager ? null : null}
    </div>
  );
}

function FeatureCopy({
  eyebrow,
  title,
  description,
  bullets,
  centered,
}: {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  centered?: boolean;
}) {
  return (
    <div className={centered ? 'mx-auto max-w-2xl text-center' : ''}>
      <p
        className={`mb-3 inline-flex items-center gap-2 rounded-full border border-[#78fcd6]/30 bg-[#78fcd6]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#78fcd6]`}
      >
        {eyebrow}
      </p>
      <h3 className="mb-4 text-3xl font-bold leading-tight text-[#F2F7F7] sm:text-4xl">
        {title}
      </h3>
      <p className="mb-6 text-lg leading-relaxed text-[#A8B2B2]">{description}</p>
      <ul
        className={`space-y-3 ${centered ? 'mx-auto inline-flex flex-col text-left' : ''}`}
      >
        {bullets.map((bullet) => (
          <li
            key={bullet}
            className="flex items-start gap-3 text-[#F2F7F7]/90"
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#78fcd6]/15 text-[#78fcd6]">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <span className="text-[15px] leading-relaxed">{bullet}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LandingPage() {
  const [isSignInModalOpen, setIsSignInModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#0B0F0F] text-[#F2F7F7]">
      {/* Hero */}
      <section className="relative overflow-hidden px-6 pt-24 pb-16 md:pt-32 lg:pt-40">
        {/* Background decorative orbs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-[#78fcd6]/10 blur-[120px] animate-float" />
          <div className="absolute -bottom-20 -right-20 h-[300px] w-[300px] rounded-full bg-[#00ffb6]/8 blur-[100px]" />
        </div>

        <div className="relative mx-auto flex max-w-5xl flex-col items-center text-center">
          {/* Badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#78fcd6]/30 bg-[#78fcd6]/10 px-4 py-1.5 text-sm font-medium text-[#78fcd6] backdrop-blur-sm">
            <Sparkles className="w-4 h-4" />
            Open Source Kanban Board
          </div>

          {/* Headline */}
          <h1 className="mb-6 max-w-3xl text-5xl font-black tracking-tight sm:text-6xl lg:text-7xl leading-[1.1]">
            Organize your work with{' '}
            <span className="gradient-cyan-text">ZeroBoard</span>
          </h1>

          {/* Description */}
          <p className="mb-10 max-w-2xl text-lg text-[#A8B2B2] leading-relaxed md:text-xl">
            A powerful, open-source Kanban board with timeline views, AI assistance,
            real-time sync, and deep customization — built for people who want more
            control of their workflow tooling.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-4">
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

          {/* Quick feature chips */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
            {quickFeatures.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#A8B2B2] backdrop-blur-sm"
              >
                <Icon className="h-3.5 w-3.5 text-[#78fcd6]" />
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Hero product screenshot — Kanban */}
        <div className="relative mx-auto mt-16 max-w-6xl px-2 md:mt-20 md:px-0">
          {/* Glow underneath */}
          <div className="pointer-events-none absolute -inset-x-10 -top-10 -bottom-10 -z-10">
            <div className="absolute inset-x-0 top-1/2 h-[400px] -translate-y-1/2 bg-[#78fcd6]/20 blur-[140px]" />
          </div>

          <div className="relative">
            <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-[#78fcd6]/40 via-transparent to-[#00ffb6]/30 opacity-60 blur-sm" />
            <div className="relative rounded-3xl bg-gradient-to-b from-white/10 to-transparent p-1 backdrop-blur-xl">
              <BrowserFrame
                src="/screenshots/kanban.png"
                alt="ZeroBoard kanban board interface with multiple columns, cards, labels, and cover images"
                ariaLabel="ZeroBoard product preview"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Trello Tribute */}
      <section className="px-6 pt-8 pb-20">
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

      {/* Section heading */}
      <section className="px-6 pb-12">
        <div className="mx-auto max-w-5xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-[#78fcd6]">
            Built for makers
          </p>
          <h2 className="text-4xl font-bold text-[#F2F7F7] sm:text-5xl">
            Everything you need,{' '}
            <span className="gradient-cyan-text">nothing you don't</span>
          </h2>
        </div>
      </section>

      {/* Wide row: AI Assistant — animated demo */}
      <section className="px-6 pb-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10">
            <FeatureCopy
              eyebrow={tallBlocks[0].eyebrow}
              title={tallBlocks[0].title}
              description={tallBlocks[0].description}
              bullets={tallBlocks[0].bullets}
              centered
            />
          </div>
          <div className="relative mx-auto max-w-3xl">
            <div className="pointer-events-none absolute -inset-8 -z-10">
              <div className="absolute inset-0 rounded-full bg-[#78fcd6]/15 blur-[100px]" />
            </div>
            <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-[#78fcd6]/40 via-transparent to-[#00ffb6]/20 opacity-60 blur-sm" />
            <BrowserFrame
              src="/screenshots/ZeroBoardAI.gif"
              alt="ZeroBoard AI assistant live demo — creating cards and organizing the board from plain-English commands"
              ariaLabel="ZeroBoard AI assistant animated demo"
              imgClassName="block h-auto w-full"
            />
          </div>
        </div>
      </section>

      {/* Wide row: Timeline */}
      <section className="px-6 pb-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10">
            <FeatureCopy
              eyebrow={timelineBlock.eyebrow}
              title={timelineBlock.title}
              description={timelineBlock.description}
              bullets={timelineBlock.bullets}
              centered
            />
          </div>
          <ScreenshotFrame src={timelineBlock.image} alt={timelineBlock.imageAlt} />
        </div>
      </section>

      {/* Two-column: Card Editor (tall dialog) — reversed */}
      <section className="px-6 pb-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16">
            <div className="mx-auto w-full max-w-md md:order-1">
              <ScreenshotFrame
                src={tallBlocks[1].image}
                alt={tallBlocks[1].imageAlt}
              />
            </div>
            <div className="md:order-2">
              <FeatureCopy
                eyebrow={tallBlocks[1].eyebrow}
                title={tallBlocks[1].title}
                description={tallBlocks[1].description}
                bullets={tallBlocks[1].bullets}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Bento grid — remaining features */}
      <section className="px-6 pb-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-[#F2F7F7] sm:text-4xl">
              Power features, no compromise
            </h2>
            <p className="mt-3 text-[#A8B2B2]">
              Sharing, templates, theming, exports, auth, and one-click deploy —
              built in from day one.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {bentoFeatures.map(({ icon: Icon, title, description, image }) => (
              <div
                key={title}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md transition-all duration-300 hover:border-[#78fcd6]/40 hover:shadow-lg hover:shadow-[#78fcd6]/10"
              >
                <div className="relative flex h-52 items-center justify-center overflow-hidden bg-[#0E1414] p-4">
                  <img
                    src={image}
                    alt=""
                    loading="lazy"
                    className="max-h-full max-w-full rounded-lg object-contain shadow-lg shadow-black/40 ring-1 ring-white/10 transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0B0F0F]/60 via-transparent to-transparent" />
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#78fcd6]/10 text-[#78fcd6] ring-1 ring-[#78fcd6]/20">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-[#F2F7F7]">
                    {title}
                  </h3>
                  <p className="text-sm leading-relaxed text-[#A8B2B2]">
                    {description}
                  </p>
                </div>
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

      {/* Final CTA */}
      <section className="px-6 pb-20">
        <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-[#78fcd6]/30 bg-gradient-to-br from-[#78fcd6]/10 via-white/5 to-[#00ffb6]/10 p-10 text-center backdrop-blur-md md:p-14">
          <div className="pointer-events-none absolute -top-20 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-[#78fcd6]/20 blur-[100px]" />
          <h2 className="relative mb-4 text-3xl font-bold text-[#F2F7F7] sm:text-4xl">
            Ready to ship your work?
          </h2>
          <p className="relative mx-auto mb-8 max-w-xl text-[#A8B2B2]">
            Spin up your first board in under a minute. No credit card, no setup —
            just a clean slate and the tools to organize anything.
          </p>
          <Button
            onClick={() => setIsSignInModalOpen(true)}
            className="relative h-12 px-8 bg-gradient-to-r from-[#78fcd6] to-[#00ffb6] text-[#0B0F0F] font-bold rounded-full text-base shadow-lg ring-2 ring-[#78fcd6]/30 hover:shadow-[#78fcd6]/50 hover:scale-105 transition-all duration-300"
          >
            Start Free
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
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
