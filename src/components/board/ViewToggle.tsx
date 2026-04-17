import { Clock, Layout } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBoardStore } from '@/store/useBoardStore';

interface ViewToggleProps {
  onBeforeTimeline?: () => void;
}

export function ViewToggle({ onBeforeTimeline }: ViewToggleProps) {
  const { viewMode, setViewMode } = useBoardStore();

  return (
    <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 flex-shrink-0">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setViewMode('board')}
        className={`h-7 px-3 rounded-md transition-all text-xs ${
          viewMode === 'board'
            ? 'bg-[#78fcd6]/20 text-[#78fcd6]'
            : 'text-[#A8B2B2] hover:text-white hover:bg-white/5'
        }`}
        aria-pressed={viewMode === 'board'}
      >
        <Layout className="w-3.5 h-3.5 sm:mr-1.5" />
        <span className="hidden sm:inline">Board</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          onBeforeTimeline?.();
          setViewMode('timeline');
        }}
        className={`h-7 px-3 rounded-md transition-all text-xs ${
          viewMode === 'timeline'
            ? 'bg-[#78fcd6]/20 text-[#78fcd6]'
            : 'text-[#A8B2B2] hover:text-white hover:bg-white/5'
        }`}
        aria-pressed={viewMode === 'timeline'}
      >
        <Clock className="w-3.5 h-3.5 sm:mr-1.5" />
        <span className="hidden sm:inline">Timeline</span>
      </Button>
    </div>
  );
}
