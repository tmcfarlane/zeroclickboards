import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe, Lock, Copy, Check, X, Code, User, Send } from 'lucide-react';
import { useBoardStore } from '@/store/useBoardStore';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import * as boardMembers from '@/lib/database/board-members';
import type { BoardMemberWithProfile, MemberRole } from '@/lib/database/board-members';
import { toast } from 'sonner';

interface ShareBoardDialogProps {
  boardId: string;
  boardName: string;
  isPublic: boolean;
  embedEnabled: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareBoardDialog({ boardId, boardName, isPublic, embedEnabled, isOpen, onOpenChange }: ShareBoardDialogProps) {
  const { toggleBoardPublic, toggleBoardEmbed } = useBoardStore();
  const { userId } = useAuth();
  const [members, setMembers] = useState<BoardMemberWithProfile[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('viewer');
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [inviting, setInviting] = useState(false);

  const shareUrl = `${window.location.origin}/board/${boardId}`;
  const embedSnippet = `<iframe src="${window.location.origin}/embed/${boardId}" width="100%" height="600" frameborder="0"></iframe>`;

  useEffect(() => {
    if (isOpen) {
      boardMembers.getMembers(boardId).then(({ data }) => {
        if (data) setMembers(data);
      });
    }
  }, [isOpen, boardId]);

  const handleInviteByEmail = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;

    setInviting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/invite/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ email, boardId, boardName, role: inviteRole }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error || 'Failed to send invite');
        return;
      }

      toast.success(`Invitation sent to ${email}`);
      setInviteEmail('');
    } finally {
      setInviting(false);
    }
  };

  const handleUpdateRole = async (memberId: string, memberUserId: string, role: MemberRole) => {
    const { error } = await boardMembers.updateRole(boardId, memberUserId, role);
    if (error) {
      toast.error('Failed to update role');
      return;
    }
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role } : m));
  };

  const handleRemoveMember = async (memberUserId: string) => {
    const { error } = await boardMembers.removeMember(boardId, memberUserId);
    if (error) {
      toast.error('Failed to remove member');
      return;
    }
    setMembers(prev => prev.filter(m => m.user_id !== memberUserId));
    toast.success('Member removed');
  };

  const copyToClipboard = (text: string, type: 'link' | 'embed') => {
    navigator.clipboard.writeText(text);
    if (type === 'link') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setEmbedCopied(true);
      setTimeout(() => setEmbedCopied(false), 2000);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] max-w-lg">
        <DialogHeader>
          <DialogTitle>Share "{boardName}"</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Public / Private Toggle */}
          <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
            <div className="flex items-center gap-3">
              {isPublic ? <Globe className="w-4 h-4 text-[#78fcd6]" /> : <Lock className="w-4 h-4 text-[#A8B2B2]" />}
              <div>
                <div className="text-sm font-medium">{isPublic ? 'Public' : 'Private'}</div>
                <div className="text-xs text-[#A8B2B2]">
                  {isPublic ? 'Anyone with the link can view' : 'Only invited members can access'}
                </div>
              </div>
            </div>
            <Switch
              checked={isPublic}
              onCheckedChange={(checked) => toggleBoardPublic(boardId, checked)}
            />
          </div>

          {/* Invite by email */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Invite by email</label>
            <div className="flex gap-2">
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Enter email address..."
                className="flex-1 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
              />
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as MemberRole)}>
                <SelectTrigger className="w-28 bg-white/5 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#111515] border-white/10">
                  <SelectItem value="viewer">View</SelectItem>
                  <SelectItem value="commenter">Comment</SelectItem>
                  <SelectItem value="editor">Modify</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="icon"
                onClick={handleInviteByEmail}
                disabled={!inviteEmail.trim() || inviting}
                className="bg-[#78fcd6] hover:bg-[#78fcd6]/80 text-[#111515] flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Shareable Link */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Shareable link</label>
            <div className="flex gap-2">
              <Input
                value={shareUrl}
                readOnly
                className="bg-white/5 border-white/10 text-[#A8B2B2] text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(shareUrl, 'link')}
                className="border-white/10 hover:bg-white/5 flex-shrink-0"
              >
                {copied ? <Check className="w-4 h-4 text-[#78fcd6]" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {/* Members list */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Members</label>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {/* Owner */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-[#A8B2B2]" />
                  <span className="text-sm">You</span>
                </div>
                <span className="text-xs text-[#78fcd6] font-medium">Owner</span>
              </div>

              {/* Other members */}
              {members.map((member) => (
                <div key={member.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5">
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="w-4 h-4 text-[#A8B2B2] flex-shrink-0" />
                    <span className="text-sm truncate">{member.profiles?.email ?? 'Unknown'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={member.role}
                      onValueChange={(v) => handleUpdateRole(member.id, member.user_id, v as MemberRole)}
                    >
                      <SelectTrigger className="w-24 h-7 text-xs bg-white/5 border-white/10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#111515] border-white/10">
                        <SelectItem value="viewer">View</SelectItem>
                        <SelectItem value="commenter">Comment</SelectItem>
                        <SelectItem value="editor">Modify</SelectItem>
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(member.user_id)}
                      className="p-1 hover:bg-white/10 rounded text-[#A8B2B2] hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Embed Settings */}
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code className="w-4 h-4 text-[#A8B2B2]" />
                <span className="text-sm font-medium">Enable Embedding</span>
              </div>
              <Switch
                checked={embedEnabled}
                onCheckedChange={(checked) => toggleBoardEmbed(boardId, checked)}
              />
            </div>
            {embedEnabled && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={embedSnippet}
                    readOnly
                    className="bg-white/5 border-white/10 text-[#A8B2B2] text-xs font-mono"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(embedSnippet, 'embed')}
                    className="border-white/10 hover:bg-white/5 flex-shrink-0"
                  >
                    {embedCopied ? <Check className="w-4 h-4 text-[#78fcd6]" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <a
                  href={`/embed/${boardId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-[#78fcd6] hover:underline"
                >
                  Preview embed in new tab
                </a>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
