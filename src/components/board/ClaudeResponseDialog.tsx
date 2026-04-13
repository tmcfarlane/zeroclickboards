import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Terminal, Loader2, AlertCircle, Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface ClaudeResponseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  response?: string;
  error?: string;
  isLoading: boolean;
}

export function ClaudeResponseDialog({ isOpen, onClose, response, error, isLoading }: ClaudeResponseDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (response) {
      await navigator.clipboard.writeText(response);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] w-[95vw] sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-[#78fcd6]" />
            Claude Response
          </DialogTitle>
        </DialogHeader>

        <div className="py-2">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 text-[#78fcd6] animate-spin" />
              <p className="text-sm text-[#A8B2B2]">Waiting for Claude...</p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {response && (
            <>
              <div className="flex justify-end mb-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-7 text-xs text-[#A8B2B2] hover:text-[#F2F7F7]"
                >
                  {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <ScrollArea className="max-h-[50vh]">
                <pre className="text-sm text-[#F2F7F7] whitespace-pre-wrap font-mono bg-white/5 p-4 rounded-lg border border-white/10">
                  {response}
                </pre>
              </ScrollArea>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
