import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { isComposingKey } from '@/lib/keyboard';

interface LeaveBoardDialogProps {
  open: boolean;
  signingOut: boolean;
  busy: boolean;
  hasForms: boolean;
  saveState: 'saving' | 'attention' | null;
  onStay: () => void;
  onLeave: () => void;
  restoreFocus: () => void;
}

export function LeaveBoardDialog({ open, signingOut, busy, hasForms, saveState, onStay, onLeave, restoreFocus }: LeaveBoardDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) onStay(); }}>
      <AlertDialogContent
        className="bg-[#111515] border-white/10 text-[#F2F7F7]"
        onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}
        onEscapeKeyDown={(event) => { if (busy || isComposingKey(event)) event.preventDefault(); }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (isComposingKey(event.nativeEvent) && (event.key === 'Enter' || event.key === 'Escape')) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{signingOut ? 'Sign out with unfinished work?' : 'Leave this page?'}</AlertDialogTitle>
          <AlertDialogDescription className="text-[#A8B2B2] space-y-2" asChild>
            <div>
              {hasForms && <p>Open forms will close. Unsaved form text will be discarded. Stay to finish or copy it.</p>}
              {saveState === 'saving' && <p>{signingOut ? 'Some board changes have not finished saving. Stay to check their status before signing out.' : 'Some board changes have not finished saving. Saving can continue while you stay signed in.'}</p>}
              {saveState === 'attention' && <p>Some board changes need attention. Stay to review their save status or recovery options.</p>}
              {!hasForms && !saveState && <p>Choose Stay to remain here or {signingOut ? 'Sign out' : 'Leave'} to continue.</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={(event) => { event.preventDefault(); onStay(); }} className="border-white/10 text-[#F2F7F7] hover:bg-white/5">Stay</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); onLeave(); }} className="gradient-cyan text-[#0B0F0F] hover:opacity-90">{busy ? 'Signing out...' : signingOut ? 'Sign out' : 'Leave'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
