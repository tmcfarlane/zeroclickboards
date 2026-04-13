import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Keyboard } from 'lucide-react';

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

const shortcuts = [
  { key: 'Ctrl + Z', description: 'Undo last action' },
  { key: 'Ctrl + Shift + Z', description: 'Redo last action' },
  { key: 'N', description: 'Add new card' },
  { key: 'Shift + N', description: 'Create new board' },
  { key: '/', description: 'Focus search' },
  { key: 'A', description: 'Toggle AI assistant' },
  { key: 'B', description: 'Switch to board view' },
  { key: 'T', description: 'Switch to timeline view' },
  { key: '?', description: 'Show keyboard shortcuts' },
];

export function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-[#78fcd6]" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {shortcuts.map(({ key, description }) => (
            <div key={key} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-[#A8B2B2]">{description}</span>
              <kbd className="px-2 py-1 text-xs font-mono bg-white/10 border border-white/10 rounded text-[#78fcd6]">
                {key}
              </kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
