import { useEffect, useLayoutEffect, useRef } from "react";
import type MatterType from "matter-js";

const WORDS = [
  "Ship",
  "Focus",
  "Flow",
  "Done",
  "Backlog",
  "Priority",
  "Now",
  "Next",
  "Sprint",
  "Today",
  "Archive",
  "Review",
  "Plan",
  "Build",
  "In Progress",
  "Blocked",
  "Shipped",
  "Ready",
  "Draft",
  "Iterate",
  "Refactor",
  "Design",
  "Test",
  "Deploy",
  "Feedback",
  "Roadmap",
  "Launch",
  "On Deck",
  "This Week",
  "Done ✓",
];

const LABEL_COLORS = [
  "#78fcd6",
  "#60a5fa",
  "#f472b6",
  "#facc15",
  "#f87171",
  "#a78bfa",
];

const DESKTOP_COUNT = 44;
const MOBILE_COUNT = 24;
const TRIGGER_DISTANCE_FROM_BOTTOM = 900;
const RELEASE_WINDOW_MS = 1800;
const MOUSE_REPEL_RADIUS = 280;
const MOUSE_REPEL_STRENGTH = 0.22;
const FOOTER_FALLBACK_HEIGHT = 80;
const FLOOR_GAP_ABOVE_FOOTER = 4;

type CardSpec = {
  word: string;
  color: string;
  spawnX: number;
  spawnY: number;
  spawnAngle: number;
  vx: number;
  vy: number;
  angularVelocity: number;
  releaseDelay: number;
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

function buildSpecs(count: number, viewportWidth: number): CardSpec[] {
  return Array.from({ length: count }, () => ({
    word: pick(WORDS),
    color: pick(LABEL_COLORS),
    spawnX: rand(40, viewportWidth - 40),
    spawnY: rand(-380, -80),
    spawnAngle: rand(-Math.PI, Math.PI),
    vx: rand(-2.5, 2.5),
    vy: rand(1.5, 4),
    angularVelocity: rand(-0.15, 0.15),
    releaseDelay: rand(0, RELEASE_WINDOW_MS),
  }));
}

export function FallingCardsShower() {
  const cardElementsRef = useRef<(HTMLDivElement | null)[]>([]);
  const specsRef = useRef<CardSpec[]>([]);
  const dimsRef = useRef<{ w: number; h: number }[]>([]);
  const triggeredRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const engineRef = useRef<MatterType.Engine | null>(null);
  const runnerRef = useRef<MatterType.Runner | null>(null);
  const matterRef = useRef<typeof MatterType | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const floorBodyRef = useRef<MatterType.Body | null>(null);

  if (specsRef.current.length === 0 && typeof window !== "undefined") {
    const isMobile = window.matchMedia("(max-width: 639px)").matches;
    specsRef.current = buildSpecs(
      isMobile ? MOBILE_COUNT : DESKTOP_COUNT,
      window.innerWidth,
    );
  }

  useLayoutEffect(() => {
    dimsRef.current = cardElementsRef.current.map((el) => {
      if (!el) return { w: 120, h: 60 };
      return { w: el.offsetWidth, h: el.offsetHeight };
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timeouts: number[] = [];

    const handleMouseMove = (e: MouseEvent) => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
    };
    const handleMouseLeave = () => {
      cursorRef.current = null;
    };

    const updateFloorPosition = () => {
      const Matter = matterRef.current;
      const floor = floorBodyRef.current;
      if (!Matter || !floor) return;
      const footerEl = document.querySelector("footer");
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const footerTopInViewport = footerEl
        ? footerEl.getBoundingClientRect().top
        : vh;
      const floorY =
        Math.min(vh, footerTopInViewport) - FLOOR_GAP_ABOVE_FOOTER;
      Matter.Body.setPosition(floor, { x: vw / 2, y: floorY + 40 });
    };

    const startPhysics = async () => {
      const Matter = (await import("matter-js")).default;
      matterRef.current = Matter;

      const specs = specsRef.current;
      const dims = dimsRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const footerEl = document.querySelector("footer");
      const footerTopInViewport = footerEl
        ? footerEl.getBoundingClientRect().top
        : vh - FOOTER_FALLBACK_HEIGHT;
      const floorY =
        Math.min(vh, footerTopInViewport) - FLOOR_GAP_ABOVE_FOOTER;

      const engine = Matter.Engine.create();
      engine.gravity.y = 1.2;
      engineRef.current = engine;

      const floor = Matter.Bodies.rectangle(vw / 2, floorY + 40, vw * 2, 80, {
        isStatic: true,
        friction: 0.8,
      });
      floorBodyRef.current = floor;
      const leftWall = Matter.Bodies.rectangle(-40, vh / 2, 80, vh * 3, {
        isStatic: true,
      });
      const rightWall = Matter.Bodies.rectangle(vw + 40, vh / 2, 80, vh * 3, {
        isStatic: true,
      });
      Matter.Composite.add(engine.world, [floor, leftWall, rightWall]);

      const bodies: (MatterType.Body | null)[] = new Array(specs.length).fill(
        null,
      );

      specs.forEach((spec, i) => {
        const { w, h } = dims[i] ?? { w: 120, h: 60 };
        const id = window.setTimeout(() => {
          const body = Matter.Bodies.rectangle(
            spec.spawnX,
            spec.spawnY,
            w,
            h,
            {
              restitution: 0.22,
              friction: 0.55,
              frictionAir: 0.012,
              density: 0.0022,
              angle: spec.spawnAngle,
              chamfer: { radius: 8 },
            },
          );
          Matter.Body.setVelocity(body, { x: spec.vx, y: spec.vy });
          Matter.Body.setAngularVelocity(body, spec.angularVelocity);
          Matter.Composite.add(engine.world, body);
          bodies[i] = body;
          const el = cardElementsRef.current[i];
          if (el) el.style.opacity = "1";
        }, spec.releaseDelay);
        timeouts.push(id);
      });

      const runner = Matter.Runner.create();
      runnerRef.current = runner;
      Matter.Runner.run(runner, engine);

      window.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseleave", handleMouseLeave);
      window.addEventListener("scroll", updateFloorPosition, { passive: true });
      window.addEventListener("resize", updateFloorPosition);

      const tick = () => {
        const cursor = cursorRef.current;
        const r = MOUSE_REPEL_RADIUS;
        const rSq = r * r;

        for (let i = 0; i < specs.length; i++) {
          const body = bodies[i];
          const el = cardElementsRef.current[i];
          if (!body || !el) continue;

          if (cursor) {
            const dx = body.position.x - cursor.x;
            const dy = body.position.y - cursor.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < rSq && distSq > 1) {
              const dist = Math.sqrt(distSq);
              const falloff = 1 - dist / r;
              const strength = MOUSE_REPEL_STRENGTH * falloff * falloff;
              Matter.Body.applyForce(body, body.position, {
                x: (dx / dist) * strength,
                y: (dy / dist) * strength,
              });
            }
          }

          const { w, h } = dims[i] ?? { w: 120, h: 60 };
          const x = body.position.x - w / 2;
          const y = body.position.y - h / 2;
          el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${body.angle}rad)`;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    const checkScroll = () => {
      if (triggeredRef.current) return;
      const distToBottom =
        document.documentElement.scrollHeight -
        window.scrollY -
        window.innerHeight;
      if (distToBottom < TRIGGER_DISTANCE_FROM_BOTTOM) {
        triggeredRef.current = true;
        window.removeEventListener("scroll", checkScroll);
        void startPhysics();
      }
    };

    window.addEventListener("scroll", checkScroll, { passive: true });
    checkScroll();

    return () => {
      window.removeEventListener("scroll", checkScroll);
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("scroll", updateFloorPosition);
      window.removeEventListener("resize", updateFloorPosition);
      timeouts.forEach((id) => window.clearTimeout(id));
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      const Matter = matterRef.current;
      if (Matter && runnerRef.current) Matter.Runner.stop(runnerRef.current);
      if (Matter && engineRef.current) {
        Matter.World.clear(engineRef.current.world, false);
        Matter.Engine.clear(engineRef.current);
      }
    };
  }, []);

  const specs = specsRef.current;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden opacity-70"
    >
      {specs.map((spec, i) => (
        <div
          key={i}
          ref={(el) => {
            cardElementsRef.current[i] = el;
          }}
          className="absolute left-0 top-0 whitespace-nowrap rounded-xl border border-white/10 bg-[#14191a]/90 px-5 py-3 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.75)] backdrop-blur-sm will-change-transform"
          style={{
            opacity: 0,
            transform: `translate3d(${spec.spawnX}px, ${spec.spawnY}px, 0) rotate(${spec.spawnAngle}rad)`,
            transition: "opacity 200ms ease-out",
          }}
        >
          <div
            className="mb-2 h-[5px] w-12 rounded-full"
            style={{ backgroundColor: spec.color }}
          />
          <div className="text-[26px] font-bold leading-none tracking-tight text-[#F2F7F7]">
            {spec.word}
          </div>
        </div>
      ))}
    </div>
  );
}
