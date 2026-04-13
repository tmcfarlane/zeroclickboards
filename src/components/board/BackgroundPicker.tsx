import { Check, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const GRADIENT_BACKGROUNDS = [
  { name: 'Ocean', value: 'linear-gradient(180deg, #0C3547 0%, #2E8B8B 100%)' },
  { name: 'Sky', value: 'linear-gradient(180deg, #1565C0 0%, #1E88E5 100%)' },
  { name: 'Sapphire', value: 'linear-gradient(180deg, #0D47A1 0%, #2979FF 100%)' },
  { name: 'Grape', value: 'linear-gradient(180deg, #6A1B9A 0%, #CE93D8 100%)' },
  { name: 'Violet', value: 'linear-gradient(180deg, #4527A0 0%, #7C4DFF 100%)' },
  { name: 'Sunset', value: 'linear-gradient(180deg, #E65100 0%, #FF6E40 100%)' },
  { name: 'Rose', value: 'linear-gradient(180deg, #AD1457 0%, #F06292 100%)' },
  { name: 'Teal', value: 'linear-gradient(180deg, #00695C 0%, #26A69A 100%)' },
  { name: 'Slate', value: 'linear-gradient(180deg, #263238 0%, #546E7A 100%)' },
  { name: 'Wine', value: 'linear-gradient(180deg, #4E342E 0%, #BF360C 100%)' },
];

const SOLID_BACKGROUNDS = [
  { name: 'Blue', value: '#0079BF' },
  { name: 'Orange', value: '#D29034' },
  { name: 'Green', value: '#519839' },
  { name: 'Red', value: '#B04632' },
  { name: 'Purple', value: '#89609E' },
  { name: 'Pink', value: '#CD519D' },
  { name: 'Lime', value: '#4BBF6B' },
  { name: 'Cyan', value: '#00AECC' },
  { name: 'Gray', value: '#838C91' },
];

interface BackgroundPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentBackground?: string;
  onSelect: (background: string | undefined) => void;
}

export function BackgroundPicker({ open, onOpenChange, currentBackground, onSelect }: BackgroundPickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] max-w-sm max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Board Background</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2 overflow-y-auto flex-1 min-h-0">
          {/* Gradients */}
          <div>
            <h3 className="text-xs font-medium text-[#A8B2B2] uppercase tracking-wider mb-3">Gradients</h3>
            <div className="grid grid-cols-3 gap-2">
              {GRADIENT_BACKGROUNDS.map((bg) => (
                <button
                  key={bg.name}
                  type="button"
                  onClick={() => onSelect(bg.value)}
                  className="relative aspect-[4/3] rounded-lg overflow-hidden ring-1 ring-white/10 hover:ring-white/30 transition-all hover:scale-105"
                  style={{ background: bg.value }}
                  title={bg.name}
                >
                  {currentBackground === bg.value && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <Check className="w-5 h-5 text-white drop-shadow-md" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Solid Colors */}
          <div>
            <h3 className="text-xs font-medium text-[#A8B2B2] uppercase tracking-wider mb-3">Colors</h3>
            <div className="grid grid-cols-3 gap-2">
              {SOLID_BACKGROUNDS.map((bg) => (
                <button
                  key={bg.name}
                  type="button"
                  onClick={() => onSelect(bg.value)}
                  className="relative aspect-[4/3] rounded-lg overflow-hidden ring-1 ring-white/10 hover:ring-white/30 transition-all hover:scale-105"
                  style={{ background: bg.value }}
                  title={bg.name}
                >
                  {currentBackground === bg.value && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <Check className="w-5 h-5 text-white drop-shadow-md" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Remove Background */}
          {currentBackground && (
            <button
              type="button"
              onClick={() => onSelect(undefined)}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-white/10 text-sm text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5 transition-colors"
            >
              <X className="w-4 h-4" />
              Remove Background
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
