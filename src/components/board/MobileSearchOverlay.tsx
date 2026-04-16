import { useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';

interface MobileSearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  value: string;
  onChange: (value: string) => void;
}

export function MobileSearchOverlay({ isOpen, onClose, value, onChange }: MobileSearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-3 py-2 bg-[#0B0F0F] border-b border-white/10 sm:hidden">
      <Search className="w-4 h-4 text-[#A8B2B2] shrink-0" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search cards..."
        className="flex-1 h-9 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
      />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => { onChange(''); onClose(); }}
        className="h-9 w-9 text-[#A8B2B2] hover:text-[#F2F7F7] shrink-0"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
