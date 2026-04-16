import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  Sparkles,
  Github,
  Heart,
  Check,
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
  ArrowRight,
  Hand,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignInModal } from "@/components/auth/SignInModal";
import { FallingCardsShower } from "@/components/FallingCardsShower";

const GITHUB_URL = import.meta.env.VITE_GITHUB_REPO_URL ?? "https://github.com";

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
  eyebrow: "Timeline / Gantt",
  title: "See the whole quarter at a glance",
  description:
    "Switch to a Gantt-style timeline to spot overlapping deadlines, scheduling gaps, and the path to launch — without leaving your board.",
  bullets: [
    "Scrollable timeline of every due date",
    "Color-coded by column and status",
    "One click back to kanban view",
  ],
  image: "/screenshots/timeline.png",
  imageAlt: "ZeroBoard timeline and Gantt chart view of cards across dates",
};

const tallBlocks: TallBlock[] = [
  {
    eyebrow: "AI Assistant",
    title: "Just tell it what you want",
    description:
      'Skip the clicks. Type "move all overdue cards to In Progress" or "add a checklist for launch tasks" — the AI assistant handles the rest.',
    bullets: [
      "Natural-language card creation & moves",
      "Bulk edits in seconds, not minutes",
      "Lives right in your board sidebar",
    ],
    image: "/screenshots/ai-assist.png",
    imageAlt:
      "ZeroBoard AI assistant chat sidebar managing cards with plain English",
  },
  {
    eyebrow: "Card Editor",
    title: "Every card, infinitely deep",
    description:
      "Checklists, attachments, rich descriptions, due dates, labels, and activity logs — all in a focused editor that stays out of your way.",
    bullets: [
      "Checklists, images, and rich text",
      "Attach covers & target dates",
      "Full activity feed on every change",
    ],
    image: "/screenshots/card-editor.png",
    imageAlt:
      "ZeroBoard card editor with labels, cover images, checklists, and activity",
    reverse: true,
  },
];

const bentoFeatures = [
  {
    icon: Share2,
    title: "Share & Collaborate",
    description:
      "Invite teammates via email with view or edit access. Changes sync in real time across every device.",
    image: "/screenshots/sharing.png",
  },
  {
    icon: BookmarkPlus,
    title: "Save as Template",
    description:
      "Turn any board or card into a reusable template and spin up new boards from it in a single click.",
    image: "/screenshots/save-as-template.png",
  },
  {
    icon: Palette,
    title: "Custom Backgrounds",
    description:
      "Personalize each board with a gradient or solid color — pick from curated presets or go custom.",
    image: "/screenshots/choose-background-color.png",
  },
  {
    icon: Download,
    title: "Export to JSON",
    description:
      "Own your data. Export any board to JSON for backup, migration, or piping into your own tooling.",
    image: "/screenshots/export-to-json.png",
  },
  {
    icon: Lock,
    title: "Google OAuth + Email",
    description:
      "Sign in with Google or email/password via Supabase Auth. Boards sync across devices instantly.",
    image: "/screenshots/sign-in-auth.png",
  },
  {
    icon: Rocket,
    title: "Deploy on Vercel",
    description:
      "One-click deploy from GitHub. Serverless API routes keep your Supabase and AI keys safe on the server.",
    image: "/screenshots/deploy-with-vercel.png",
  },
];

const quickFeatures = [
  { icon: Layout, label: "Kanban Boards" },
  { icon: Clock, label: "Timeline / Gantt" },
  { icon: Wand2, label: "AI Assistant" },
  { icon: GripVertical, label: "Drag & Drop" },
  { icon: RefreshCw, label: "Real-time Sync" },
  { icon: Pencil, label: "Card Editor" },
];

const freePlanFeatures = [
  "Unlimited boards, columns & cards",
  "Drag & drop reordering",
  "Timeline / Gantt view",
  "Card templates",
  "Real-time sync",
  "Open source & self-hostable",
];

function EmbeddedBoard({
  src,
  fallbackSrc,
  fallbackAlt,
  ariaLabel,
  timeoutMs = 6000,
}: {
  src: string;
  fallbackSrc: string;
  fallbackAlt: string;
  ariaLabel?: string;
  timeoutMs?: number;
}) {
  const [isMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 639px)").matches,
  );
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  const loadedRef = useRef(false);

  useEffect(() => {
    if (isMobile) return;
    const t = window.setTimeout(() => {
      if (!loadedRef.current) setStatus("failed");
    }, timeoutMs);
    return () => window.clearTimeout(t);
  }, [timeoutMs, isMobile]);

  if (isMobile) {
    return (
      <div
        aria-label={ariaLabel}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0E1414] shadow-2xl shadow-black/60"
      >
        <div
          className="h-[550px] w-full overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Drag horizontally to explore the board"
        >
          <img
            src={fallbackSrc}
            alt={fallbackAlt}
            loading="lazy"
            draggable={false}
            className="block h-full w-auto max-w-none select-none"
          />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-[#78fcd6] opacity-60 shadow-lg backdrop-blur-sm"
        >
          <Hand className="h-5 w-5" />
        </div>
      </div>
    );
  }

  return (
    <div
      aria-label={ariaLabel}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0E1414] shadow-2xl shadow-black/60"
    >
      <div className="relative h-[550px] w-full">
        {status !== "failed" && (
          <iframe
            src={src}
            title={ariaLabel ?? "Embedded ZeroBoard"}
            className={`absolute inset-0 h-[100%] w-full border-0 bg-[#0b0f0f] transition-opacity duration-500 ${
              status === "loaded" ? "opacity-100" : "opacity-0"
            }`}
            loading="lazy"
            onLoad={() => {
              loadedRef.current = true;
              setStatus("loaded");
            }}
            onError={() => setStatus("failed")}
          />
        )}
        {status !== "loaded" && (
          <img
            src={fallbackSrc}
            alt={fallbackAlt}
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        )}
      </div>
    </div>
  );
}

function BrowserFrame({
  src,
  alt,
  ariaLabel,
  imgClassName,
  zoom,
  hideChrome,
}: {
  src: string;
  alt: string;
  ariaLabel?: string;
  imgClassName?: string;
  zoom?: number;
  hideChrome?: boolean;
}) {
  const [origin, setOrigin] = useState("50% 50%");
  const [isZoomed, setIsZoomed] = useState(false);
  const zoomEnabled = typeof zoom === "number";

  const updateOriginFromEvent = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setOrigin(`${x}% ${y}%`);
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!zoomEnabled || !isZoomed) return;
    updateOriginFromEvent(e);
  };

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!zoomEnabled) return;
    updateOriginFromEvent(e);
    setIsZoomed((prev) => !prev);
  };

  return (
    <div
      aria-label={ariaLabel}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0E1414] shadow-2xl shadow-black/60"
    >
      {/* Browser chrome */}
      {!hideChrome && (
        <div className="flex items-center gap-2 border-b border-white/5 bg-[#0B0F0F] px-4 py-2.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]/80" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]/80" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]/80" />
          <div className="ml-3 hidden flex-1 items-center gap-2 rounded-md bg-white/5 px-3 py-1 text-xs text-[#A8B2B2] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#78fcd6]" />
            board.zeroclickdev.ai
          </div>
        </div>
      )}
      <div
        className={
          zoomEnabled
            ? `relative overflow-hidden ${isZoomed ? "cursor-zoom-out" : "cursor-zoom-in"}`
            : ""
        }
        onClick={zoomEnabled ? handleClick : undefined}
        onMouseMove={zoomEnabled ? handleMouseMove : undefined}
        onMouseLeave={zoomEnabled ? () => setIsZoomed(false) : undefined}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          style={
            zoomEnabled
              ? {
                  transformOrigin: origin,
                  transform: isZoomed ? `scale(${zoom})` : "scale(1)",
                }
              : undefined
          }
          className={`${imgClassName ?? "block h-auto w-full"}${zoomEnabled ? " motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-reduce:transform-none" : ""}`}
        />
      </div>
    </div>
  );
}

function ScreenshotFrame({
  src,
  alt,
  className,
  zoom,
  hideChrome,
}: {
  src: string;
  alt: string;
  className?: string;
  zoom?: number;
  hideChrome?: boolean;
}) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-8 -z-10">
        <div className="absolute inset-0 rounded-full bg-[#78fcd6]/15 blur-[100px]" />
      </div>
      <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-[#78fcd6]/40 via-transparent to-[#00ffb6]/20 opacity-60 blur-sm" />
      <BrowserFrame
        src={src}
        alt={alt}
        imgClassName={className}
        ariaLabel={alt}
        zoom={zoom}
        hideChrome={hideChrome}
      />
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
    <div className={centered ? "mx-auto max-w-2xl text-center" : ""}>
      <p
        className={`mb-3 inline-flex items-center gap-2 rounded-full border border-[#78fcd6]/30 bg-[#78fcd6]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#78fcd6]`}
      >
        {eyebrow}
      </p>
      <h3 className="mb-4 text-3xl font-bold leading-tight text-[#F2F7F7] sm:text-4xl">
        {title}
      </h3>
      <p className="mb-6 text-lg leading-relaxed text-[#A8B2B2]">
        {description}
      </p>
      <ul
        className={`space-y-3 ${centered ? "mx-auto inline-flex flex-col text-left" : ""}`}
      >
        {bullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-3 text-[#F2F7F7]/90">
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
  const [activeBentoIndex, setActiveBentoIndex] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-[#0B0F0F] text-[#F2F7F7]">
      {/* Hero */}
      <section className="relative overflow-hidden px-6 pt-8 pb-16 md:pt-12">
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
            Organize your work with{" "}
            <span className="gradient-cyan-text">ZeroBoard</span>
          </h1>

          {/* Description */}
          <p className="mb-10 max-w-2xl text-lg text-[#A8B2B2] leading-relaxed md:text-xl">
            A powerful, open-source Kanban board with timeline views, AI
            assistance, real-time sync, and deep customization — built for
            people who want more control of their workflow tooling.
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

          <div className="mb-6 text-center md:mb-8">
            <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-[#78fcd6]">
              Try it live
            </p>
            <h2 className="text-2xl font-bold text-[#F2F7F7] sm:text-3xl">
              A real ZeroBoard, embedded right here
            </h2>
          </div>

          <div className="relative">
            <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-[#78fcd6]/40 via-transparent to-[#00ffb6]/30 opacity-60 blur-sm" />
            <div className="relative rounded-3xl bg-gradient-to-b from-white/10 to-transparent p-1 backdrop-blur-xl">
              <EmbeddedBoard
                src="https://board.zeroclickdev.ai/embed/9df8454b-d1f6-4c6f-83b3-d4a710d45fc9"
                fallbackSrc="/screenshots/kanban.png"
                fallbackAlt="ZeroBoard kanban board interface with multiple columns, cards, labels, and cover images"
                ariaLabel="ZeroBoard live product preview"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Trello Tribute */}
      <section className="px-6 py-12 md:py-16">
        <div className="mx-auto max-w-2xl bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-8 text-center">
          <div className="mb-3 flex justify-center">
            <Heart className="w-6 h-6 text-[#78fcd6]" />
          </div>
          <h2 className="mb-4 text-2xl font-bold text-[#F2F7F7]">
            Born from Love for Trello
          </h2>
          <p className="text-[#A8B2B2] leading-relaxed">
            We're huge fans of Trello. Some of us have used it for over 15 years
            to track daily activities, work routines, food habits, sleep
            schedules, and more. We simply wanted more customization and control
            of our tooling.
          </p>
        </div>
      </section>

      {/* Section heading */}
      <section className="px-6 py-20 md:py-24">
        <div className="mx-auto max-w-5xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-[#78fcd6]">
            Built for makers
          </p>
          <h2 className="text-4xl font-bold text-[#F2F7F7] sm:text-5xl">
            Everything you need,{" "}
            <span className="gradient-cyan-text">nothing you don't</span>
          </h2>
        </div>
      </section>

      {/* Wide row: AI Assistant — animated demo */}
      <section className="px-6 py-16 md:py-20">
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
      <section className="px-6 py-16 md:py-20">
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
          <ScreenshotFrame
            src={timelineBlock.image}
            alt={timelineBlock.imageAlt}
            zoom={1.6}
          />
        </div>
      </section>

      {/* Two-column: Card Editor (tall dialog) — reversed */}
      <section className="px-6 py-20 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-2 md:gap-20">
            <div className="mx-auto w-full max-w-sm md:order-1 motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-safe:hover:scale-[1.20] motion-reduce:transform-none">
              <ScreenshotFrame
                src={tallBlocks[1].image}
                alt={tallBlocks[1].imageAlt}
                hideChrome
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
      <section className="px-6 py-16 md:py-20">
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

          <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
            {bentoFeatures.map(
              ({ icon: Icon, title, description, image }, idx) => {
                const isActive = activeBentoIndex === idx;
                return (
                  <button
                    key={title}
                    type="button"
                    aria-pressed={isActive}
                    aria-label={`${title} — ${isActive ? "collapse" : "enlarge"} preview`}
                    onMouseEnter={() => setActiveBentoIndex(idx)}
                    onFocus={() => setActiveBentoIndex(idx)}
                    onClick={() =>
                      setActiveBentoIndex((prev) => (prev === idx ? null : idx))
                    }
                    onMouseLeave={() =>
                      setActiveBentoIndex((prev) =>
                        prev === idx ? null : prev,
                      )
                    }
                    onBlur={() =>
                      setActiveBentoIndex((prev) =>
                        prev === idx ? null : prev,
                      )
                    }
                    className={`group relative flex w-full flex-col overflow-hidden rounded-2xl border bg-white/5 text-left backdrop-blur-md transition-colors duration-500 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[#78fcd6]/60 ${
                      isActive
                        ? "border-[#78fcd6]/50 shadow-xl shadow-[#78fcd6]/20"
                        : "border-white/10 hover:border-[#78fcd6]/40 hover:shadow-lg hover:shadow-[#78fcd6]/10"
                    }`}
                  >
                    <div
                      className={`relative flex items-center justify-center overflow-hidden bg-[#0E1414] p-4 transition-[height,padding] duration-500 ease-out ${
                        isActive ? "h-[22rem] p-6" : "h-52 p-4"
                      }`}
                    >
                      <img
                        src={image}
                        alt=""
                        loading="lazy"
                        className={`max-h-full max-w-full rounded-lg object-contain shadow-lg shadow-black/40 ring-1 ring-white/10 transition-transform duration-500 ease-out ${
                          isActive
                            ? "scale-100"
                            : "scale-100 group-hover:scale-[1.03]"
                        }`}
                      />
                      <div
                        className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${
                          isActive
                            ? "bg-gradient-to-t from-[#0B0F0F]/20 via-transparent to-transparent"
                            : "bg-gradient-to-t from-[#0B0F0F]/60 via-transparent to-transparent"
                        }`}
                      />
                      <div
                        aria-hidden="true"
                        className={`pointer-events-none absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-xs text-[#78fcd6] backdrop-blur-sm transition-opacity duration-300 ${
                          isActive
                            ? "opacity-0"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        +
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col p-6">
                      <div
                        className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ring-1 transition-colors duration-500 ${
                          isActive
                            ? "bg-[#78fcd6]/20 text-[#78fcd6] ring-[#78fcd6]/40"
                            : "bg-[#78fcd6]/10 text-[#78fcd6] ring-[#78fcd6]/20"
                        }`}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <h3 className="mb-2 text-lg font-semibold text-[#F2F7F7]">
                        {title}
                      </h3>
                      <p className="text-sm leading-relaxed text-[#A8B2B2]">
                        {description}
                      </p>
                    </div>
                  </button>
                );
              },
            )}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="px-6 py-16 md:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-10 text-center text-3xl font-bold text-[#F2F7F7]">
            Simple pricing
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Free plan */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 flex flex-col transition-all duration-300 hover:scale-[1.01] hover:border-white/20 hover:bg-white/[0.07]">
              <h3 className="mb-1 text-xl font-bold text-[#F2F7F7]">Free</h3>
              <p className="mb-6 text-3xl font-black text-[#F2F7F7]">
                $0
                <span className="text-base font-normal text-[#A8B2B2]">
                  /forever
                </span>
              </p>
              <ul className="space-y-2.5 flex-1">
                {freePlanFeatures.map((feat) => (
                  <li
                    key={feat}
                    className="flex items-start gap-2.5 text-sm text-[#A8B2B2]"
                  >
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
            <div className="relative overflow-hidden bg-white/5 backdrop-blur-md border border-[#78fcd6]/40 rounded-2xl p-6 flex flex-col shadow-lg shadow-[#78fcd6]/10 ring-1 ring-[#78fcd6]/20 transition-all duration-300 hover:scale-[1.04] hover:border-[#78fcd6]/70 hover:shadow-xl hover:shadow-[#78fcd6]/30 hover:ring-[#78fcd6]/40">
              <div className="absolute inset-x-0 top-0 h-1 gradient-cyan" />
              <div className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-[#78fcd6]/10 px-3 py-0.5 text-xs font-semibold text-[#78fcd6] border border-[#78fcd6]/30">
                <Sparkles className="w-3 h-3" />
                Best Value
              </div>
              <h3 className="mb-1 text-xl font-bold text-[#F2F7F7]">AI Pro</h3>
              <p className="mb-1 text-3xl font-black text-[#78fcd6]">
                $3
                <span className="text-base font-normal text-[#A8B2B2]">
                  /month
                </span>
              </p>
              <p className="mb-6 text-sm text-[#A8B2B2]">
                Less than a coffee. Everything in Free, plus:
              </p>
              <ul className="space-y-2.5">
                <li className="flex items-start gap-2.5 text-sm text-[#A8B2B2]">
                  <span className="mt-0.5 text-[#78fcd6]">✓</span>
                  Your personal AI that turns plain English into instant board updates
                </li>
                <li className="flex items-start gap-2.5 text-sm text-[#A8B2B2]">
                  <span className="mt-0.5 text-[#78fcd6]">✓</span>
                  Skip the line with priority support and first access to every new feature
                </li>
              </ul>
              <div className="mt-4 flex-1 rounded-xl border border-[#78fcd6]/20 bg-[#78fcd6]/[0.04] p-3.5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#78fcd6]/90">
                  Just say things like:
                </p>
                <div className="space-y-1.5 text-sm italic text-[#A8B2B2]">
                  <p>“Move all Q3 tasks to Done”</p>
                  <p>“Add a design review card due Friday”</p>
                  <p>“Label every marketing card high priority”</p>
                </div>
              </div>
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
      <section className="px-6 py-12 md:py-16">
        <div className="mx-auto max-w-2xl bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-8 text-center">
          <Github className="mx-auto mb-4 w-8 h-8 text-[#78fcd6]" />
          <h2 className="mb-3 text-2xl font-bold text-[#F2F7F7]">
            Proudly Open Source
          </h2>
          <p className="mb-6 text-[#A8B2B2] leading-relaxed">
            ZeroBoard is fully open source. Read the code, fork it, self-host
            it, or contribute back. The community is what makes this project
            great.
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

      {/* Final CTA — hidden for now, keep around for future use */}
      {/*
      <section className="px-6 py-12 md:py-20">
        <div className="relative mx-auto max-w-2xl overflow-hidden rounded-3xl border border-[#78fcd6]/30 bg-gradient-to-br from-[#78fcd6]/10 via-white/5 to-[#00ffb6]/10 p-8 backdrop-blur-md md:p-10">
          <div className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-[#78fcd6]/20 blur-[100px]" />
          <div className="relative flex flex-col items-center gap-5 text-center md:flex-row md:justify-center md:gap-6 md:text-left">
            <div className="max-w-md">
              <h2 className="mb-2 text-2xl font-bold text-[#F2F7F7] sm:text-3xl">
                Ready to ship your work?
              </h2>
              <p className="text-[#A8B2B2]">
                Spin up your first board in under a minute. No credit card, no
                setup.
              </p>
            </div>
            <Button
              onClick={() => setIsSignInModalOpen(true)}
              className="group relative h-12 shrink-0 overflow-hidden rounded-full bg-gradient-to-b from-[#8ffde0] via-[#78fcd6] to-[#00ffb6] px-8 text-base font-bold text-[#0B0F0F] shadow-[0_10px_30px_-8px_rgba(120,252,214,0.55),inset_0_1px_0_rgba(255,255,255,0.55)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-8px_rgba(120,252,214,0.75),inset_0_1px_0_rgba(255,255,255,0.7)]"
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
              <span className="relative inline-flex items-center">
                Start Free
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-300 ease-out group-hover:translate-x-1" />
              </span>
            </Button>
          </div>
        </div>
      </section>
      */}

      {/* Pile tagline + clearance for falling cards */}
      <div className="relative z-50 px-6 pt-10 pb-[36vh] text-center">
        <p
          className="mb-8 text-5xl leading-tight text-[#F2F7F7] sm:text-6xl md:text-7xl"
          style={{ fontFamily: "'Caveat', cursive" }}
        >
          This is your work{" "}
          <span
            className="underline"
            style={{
              textDecorationColor: "#78fcd6",
              textDecorationThickness: "4px",
              textUnderlineOffset: "6px",
              textDecorationSkipInk: "none",
            }}
          >
            without a board
          </span>
          .
        </p>

        <button
          type="button"
          onClick={() => setIsSignInModalOpen(true)}
          className="group relative inline-flex h-14 items-center overflow-hidden rounded-full bg-gradient-to-b from-[#8ffde0] via-[#78fcd6] to-[#00ffb6] px-8 text-lg font-bold text-[#0B0F0F] shadow-[0_10px_30px_-8px_rgba(120,252,214,0.55),inset_0_1px_0_rgba(255,255,255,0.55)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-8px_rgba(120,252,214,0.75),inset_0_1px_0_rgba(255,255,255,0.7)]"
        >
          <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
          <span className="relative inline-flex items-center">
            Fix this now
            <ArrowRight className="ml-2 h-5 w-5 transition-transform duration-300 ease-out group-hover:translate-x-1" />
          </span>
        </button>
      </div>

      <SignInModal
        isOpen={isSignInModalOpen}
        onOpenChange={setIsSignInModalOpen}
      />

      <FallingCardsShower />
    </div>
  );
}
