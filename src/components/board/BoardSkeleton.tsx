import { Skeleton } from '@/components/ui/skeleton';

export function BoardSkeleton() {
  return (
    <div className="h-full flex flex-col animate-in fade-in duration-300">
      {/* Header skeleton */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div>
          <Skeleton className="h-5 w-40 bg-white/5" />
          <Skeleton className="h-3.5 w-56 bg-white/5 mt-2" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-48 bg-white/5 rounded-lg" />
          <Skeleton className="h-9 w-20 bg-white/5 rounded-lg" />
          <Skeleton className="h-9 w-24 bg-white/5 rounded-lg" />
        </div>
      </div>

      {/* Columns skeleton */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full flex items-start gap-4 p-4">
          {[3, 4, 2, 3].map((cardCount, colIdx) => (
            <div
              key={colIdx}
              className="w-72 sm:w-80 shrink-0 rounded-xl bg-white/[0.02] border border-white/5 p-3"
            >
              {/* Column header */}
              <div className="flex items-center justify-between mb-3">
                <Skeleton className="h-4 w-24 bg-white/5" />
                <Skeleton className="h-4 w-6 bg-white/5 rounded" />
              </div>

              {/* Card skeletons */}
              <div className="space-y-2.5">
                {Array.from({ length: cardCount }).map((_, cardIdx) => (
                  <div
                    key={cardIdx}
                    className="rounded-lg bg-white/[0.03] border border-white/5 p-3 space-y-2"
                  >
                    {/* Random label dots on some cards */}
                    {cardIdx % 2 === 0 && (
                      <div className="flex gap-1.5">
                        <Skeleton className="h-1.5 w-8 rounded-full bg-white/5" />
                        <Skeleton className="h-1.5 w-6 rounded-full bg-white/5" />
                      </div>
                    )}
                    <Skeleton className="h-3.5 w-full bg-white/5" />
                    {cardIdx % 3 !== 0 && (
                      <Skeleton className="h-3 w-3/5 bg-white/5" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
