import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Globe,
  Lock,
  Copy,
  Check,
  X,
  Code,
  User,
  Send,
  Shield,
  Clock,
  Mail,
} from "lucide-react";
import { useBoardStore } from "@/store/useBoardStore";
import { supabase } from "@/lib/supabase";
import * as boardMembers from "@/lib/database/board-members";
import type {
  BoardMemberWithProfile,
  MemberRole,
} from "@/lib/database/board-members";
import { toast } from "sonner";

interface ShareBoardDialogProps {
  boardId: string;
  boardName: string;
  isPublic: boolean;
  embedEnabled: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareBoardDialog({
  boardId,
  boardName,
  isPublic,
  embedEnabled,
  isOpen,
  onOpenChange,
}: ShareBoardDialogProps) {
  const { toggleBoardPublic, toggleBoardEmbed } = useBoardStore();
  const [members, setMembers] = useState<BoardMemberWithProfile[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("viewer");
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<
    { id: string; email: string; role: string; created_at: string }[]
  >([]);

  const shareUrl = `${window.location.origin}/board/${boardId}`;
  const embedSnippet = `<iframe src="${window.location.origin}/embed/${boardId}" width="100%" height="600" frameborder="0"></iframe>`;

  const refreshData = useCallback(async () => {
    const [membersResult, invitesResult] = await Promise.all([
      boardMembers.getMembers(boardId),
      supabase
        .from("board_invites")
        .select("id, email, role, created_at")
        .eq("board_id", boardId),
    ]);
    if (membersResult.data) setMembers(membersResult.data);
    if (invitesResult.data) setPendingInvites(invitesResult.data);
  }, [boardId]);

  useEffect(() => {
    if (isOpen) {
      void refreshData();
    }
  }, [isOpen, refreshData]);

  const handleInviteByEmail = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;

    setInviting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/invite/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ email, boardId, boardName, role: inviteRole }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error || "Failed to send invite");
        return;
      }

      toast.success(`Invitation sent to ${email}`);
      setInviteEmail("");
      void refreshData();
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    const { error } = await supabase
      .from("board_invites")
      .delete()
      .eq("id", inviteId);
    if (error) {
      toast.error("Failed to revoke invite");
      return;
    }
    setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
    toast.success("Invite revoked");
  };

  const handleUpdateRole = async (
    memberId: string,
    memberUserId: string,
    role: MemberRole,
  ) => {
    const { error } = await boardMembers.updateRole(
      boardId,
      memberUserId,
      role,
    );
    if (error) {
      toast.error("Failed to update role");
      return;
    }
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, role } : m)),
    );
  };

  const handleRemoveMember = async (memberUserId: string) => {
    const { error } = await boardMembers.removeMember(boardId, memberUserId);
    if (error) {
      toast.error("Failed to remove member");
      return;
    }
    setMembers((prev) => prev.filter((m) => m.user_id !== memberUserId));
    toast.success("Member removed");
  };

  const copyToClipboard = (text: string, type: "link" | "embed") => {
    navigator.clipboard.writeText(text);
    if (type === "link") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setEmbedCopied(true);
      setTimeout(() => setEmbedCopied(false), 2000);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] max-w-[calc(100%-2rem)] sm:max-w-lg max-h-[85vh] overflow-y-auto top-[50%] left-[50%]">
        <DialogHeader>
          <DialogTitle>Share "{boardName}"</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="share" className="w-full overflow-hidden">
          <TabsList className="w-full bg-white/5 border border-white/10">
            <TabsTrigger
              value="share"
              className="flex-1 data-[state=active]:bg-white/10 data-[state=active]:text-[#78fcd6]"
            >
              <Send className="w-3.5 h-3.5 mr-1.5" />
              Share
            </TabsTrigger>
            <TabsTrigger
              value="permissions"
              className="flex-1 data-[state=active]:bg-white/10 data-[state=active]:text-[#78fcd6]"
            >
              <Shield className="w-3.5 h-3.5 mr-1.5" />
              Permissions
              {members.length + pendingInvites.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-[#78fcd6]/20 text-[#78fcd6] rounded-full px-1.5">
                  {members.length + pendingInvites.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Share Tab ── */}
          <TabsContent value="share" className="space-y-5 mt-4">
            {/* Public / Private Toggle */}
            <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
              <div className="flex items-center gap-3">
                {isPublic ? (
                  <Globe className="w-4 h-4 text-[#78fcd6]" />
                ) : (
                  <Lock className="w-4 h-4 text-[#A8B2B2]" />
                )}
                <div>
                  <div className="text-sm font-medium">
                    {isPublic ? "Public" : "Private"}
                  </div>
                  <div className="text-xs text-[#A8B2B2]">
                    {isPublic
                      ? "Anyone with the link can view"
                      : "Only invited members can access"}
                  </div>
                </div>
              </div>
              <Switch
                checked={isPublic}
                onCheckedChange={(checked) =>
                  toggleBoardPublic(boardId, checked)
                }
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
                <Select
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v as MemberRole)}
                >
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
                  onClick={() => copyToClipboard(shareUrl, "link")}
                  className="border-white/10 hover:bg-white/5 flex-shrink-0"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-[#78fcd6]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
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
                  onCheckedChange={(checked) =>
                    toggleBoardEmbed(boardId, checked)
                  }
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
                      onClick={() => copyToClipboard(embedSnippet, "embed")}
                      className="border-white/10 hover:bg-white/5 flex-shrink-0"
                    >
                      {embedCopied ? (
                        <Check className="w-4 h-4 text-[#78fcd6]" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
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
          </TabsContent>

          {/* ── Permissions Tab ── */}
          <TabsContent value="permissions" className="space-y-4 mt-4 overflow-hidden">
            {/* Owner */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#78fcd6]/20 flex items-center justify-center">
                  <User className="w-4 h-4 text-[#78fcd6]" />
                </div>
                <div>
                  <div className="text-sm font-medium">You</div>
                  <div className="text-xs text-[#A8B2B2]">Board owner</div>
                </div>
              </div>
              <span className="text-xs text-[#78fcd6] font-medium bg-[#78fcd6]/10 px-2.5 py-1 rounded-full">
                Owner
              </span>
            </div>

            {/* Members */}
            {members.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-[#A8B2B2] mb-2">
                  Active Members
                </p>
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4 text-[#A8B2B2]" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {member.profiles?.full_name ||
                            member.profiles?.email?.split("@")[0] ||
                            "Unknown"}
                        </div>
                        <div className="text-xs text-[#A8B2B2] truncate">
                          {member.profiles?.email ?? ""}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={member.role}
                        onValueChange={(v) =>
                          handleUpdateRole(
                            member.id,
                            member.user_id,
                            v as MemberRole,
                          )
                        }
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
                        className="p-1 hover:bg-white/10 rounded text-[#A8B2B2] hover:text-red-400 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pending Invites */}
            {pendingInvites.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-[#A8B2B2] mb-2">
                  Pending Invites
                </p>
                {pendingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                        <Mail className="w-4 h-4 text-amber-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {invite.email}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-amber-400 flex-wrap">
                          <Clock className="w-3 h-3" />
                          <span>Pending</span>
                          <span className="text-[#A8B2B2]">
                            as{" "}
                            {invite.role === "editor"
                              ? "Modify"
                              : invite.role === "commenter"
                                ? "Comment"
                                : "View"}
                          </span>
                          <span className="text-[#A8B2B2]">
                            &middot; Sent {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(invite.created_at))}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevokeInvite(invite.id)}
                      className="p-1 hover:bg-white/10 rounded text-[#A8B2B2] hover:text-red-400 transition-colors"
                      title="Revoke invite"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {members.length === 0 && pendingInvites.length === 0 && (
              <div className="text-center py-6">
                <Shield className="w-8 h-8 text-[#A8B2B2]/30 mx-auto mb-2" />
                <p className="text-sm text-[#A8B2B2]">No members yet</p>
                <p className="text-xs text-[#A8B2B2]/60 mt-1">
                  Invite people from the Share tab to collaborate
                </p>
              </div>
            )}

          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
