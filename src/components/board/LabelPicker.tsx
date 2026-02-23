import React from 'react';
import { Tag } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CardLabel } from '@/types';

const LABEL_COLORS: { color: CardLabel; bg: string; border: string }[] = [
  { color: 'red', bg: 'bg-[#ef4444]', border: 'border-[#ef4444]' },
  { color: 'yellow', bg: 'bg-[#eab308]', border: 'border-[#eab308]' },
  { color: 'green', bg: 'bg-[#22c55e]', border: 'border-[#22c55e]' },
  { color: 'blue', bg: 'bg-[#3b82f6]', border: 'border-[#3b82f6]' },
  { color: 'purple', bg: 'bg-[#a855f7]', border: 'border-[#a855f7]' },
  { color: 'gray', bg: 'bg-[#6b7280]', border: 'border-[#6b7280]' },
];

interface LabelPickerProps {
  selectedLabels: CardLabel[];
  onChange: (labels: CardLabel[]) => void;
  trigger?: React.ReactNode;
}

export function LabelPicker({ selectedLabels, onChange, trigger }: LabelPickerProps) {
  const toggleLabel = (color: CardLabel) => {
    if (selectedLabels.includes(color)) {
      onChange(selectedLabels.filter((l) => l !== color));
    } else {
      onChange([...selectedLabels, color]);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2 border-white/10 bg-zinc-900/50 text-white/70 hover:bg-zinc-800 hover:text-white"
          >
            <Tag className="h-4 w-4" />
            Labels
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="border-zinc-800 bg-zinc-900 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">Labels</DialogTitle>
        </DialogHeader>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {LABEL_COLORS.map(({ color, bg }) => (
            <button
              key={color}
              onClick={() => toggleLabel(color)}
              className={cn(
                'group relative flex items-center gap-2 rounded-md px-3 py-2 transition-all',
                'hover:bg-white/5',
                selectedLabels.includes(color) && 'bg-white/10'
              )}
            >
              <div
                className={cn(
                  'h-4 w-4 rounded-full transition-transform',
                  bg,
                  selectedLabels.includes(color) && 'scale-110 ring-2 ring-white/30'
                )}
              />
              <span className="text-sm capitalize text-white/80">{color}</span>
              {selectedLabels.includes(color) && (
                <div className="absolute right-2 h-2 w-2 rounded-full bg-[#78fcd6]" />
              )}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-1">
          {selectedLabels.map((label) => {
            const labelColor = LABEL_COLORS.find((l) => l.color === label);
            return (
              <div
                key={label}
                className={cn(
                  'h-2 w-8 rounded-full',
                  labelColor?.bg
                )}
              />
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LabelBadge({ color }: { color: CardLabel }) {
  const labelColor = LABEL_COLORS.find((l) => l.color === color);
  return (
    <div
      className={cn(
        'h-2 w-2 rounded-full',
        labelColor?.bg
      )}
      title={color}
    />
  );
}

export function LabelStrip({ labels }: { labels: CardLabel[] }) {
  if (!labels || labels.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label) => {
        const labelColor = LABEL_COLORS.find((l) => l.color === label);
        return (
          <div
            key={label}
            className={cn(
              'h-2 w-8 rounded-full transition-all hover:w-12',
              labelColor?.bg
            )}
            title={label}
          />
        );
      })}
    </div>
  );
}
