import { Button } from '@/components/ui/button';
import { Plus, Sparkles } from 'lucide-react';

interface MobileBottomBarProps {
  onAIClick?: () => void;
  onAddCard: () => void;
}

export function MobileBottomBar({ onAIClick, onAddCard }: MobileBottomBarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-white/10 bg-[#0B0F0F]/90 backdrop-blur-sm sm:hidden">
      {onAIClick && (
        <Button
          onClick={onAIClick}
          variant="ghost"
          className="flex-1 h-11 gap-2 text-sm font-medium text-[#78fcd6] bg-[#78fcd6]/10 border border-[#78fcd6]/30 hover:bg-[#78fcd6]/20"
        >
          <Sparkles className="w-4 h-4" />
          Ask AI
        </Button>
      )}
      <Button
        onClick={onAddCard}
        variant="ghost"
        className="flex-1 h-11 gap-2 text-sm font-medium text-[#F2F7F7] bg-white/5 border border-white/10 hover:bg-white/10"
      >
        <Plus className="w-4 h-4" />
        Add Card
      </Button>
    </div>
  );
}
