import { useState, useEffect, useCallback, useRef } from "react";
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
  onDraftChange?: (hasDraft: boolean) => void;
}

export function ShareBoardDialog({
  boardId,
  boardName,
  isPublic,
  embedEnabled,
  isOpen,
  onOpenChange,
  onDraftChange,
}: ShareBoardDialogProps) {
  const { toggleBoardPublic, toggleBoardEmbed } = useBoardStore();
  const canManage = useBoardStore((state) => state.canManageBoard(boardId));
  const [members, setMembers] = useState<BoardMemberWithProfile[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("viewer");
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsLoaded, setDetailsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const loadVersion = useRef(0);
  const [pendingInvites, setPendingInvites] = useState<
    { id: string; email: string; role: string; created_at: string }[]
  >([]);

  const shareUrl = `${window.location.origin}/board/${boardId}`;
  const embedSnippet = `<iframe src="${window.location.origin}/embed/${boardId}" width="100%" height="600" frameborder="0"></iframe>`;

  const refreshData = useCallback(async () => {
    if (!useBoardStore.getState().canManageBoard(boardId)) return;
    const version = ++loadVersion.current;
    setLoadingDetails(true);
    setLoadError(false);
    try {
      const [membersResult, invitesResult] = await Promise.all([
        boardMembers.getMembers(boardId),
        supabase.from("board_invites").select("id, email, role, created_at").eq("board_id", boardId),
      ]);
      if (version !== loadVersion.current || !useBoardStore.getState().canManageBoard(boardId)) return;
      if (membersResult.error || invitesResult.error || !membersResult.data || !invitesResult.data) throw new Error("Unable to load sharing details");
      setMembers(membersResult.data);
      setPendingInvites(invitesResult.data);
      setDetailsLoaded(true);
    } catch {
      if (version === loadVersion.current && useBoardStore.getState().canManageBoard(boardId)) setLoadError(true);
    } finally {
      if (version === loadVersion.current) setLoadingDetails(false);
    }
  }, [boardId]);

  useEffect(() => {
    const versionRef = loadVersion;
    if (isOpen && canManage) {
      void refreshData();
    }
    return () => { versionRef.current++; };
  }, [isOpen, canManage, refreshData]);

  const hasOwnerAccess = () => useBoardStore.getState().canManageBoard(boardId);

  const handleInviteByEmail = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !hasOwnerAccess()) return;

    setInviting(true);
    let requestAttempted = false;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || !hasOwnerAccess()) return;
      requestAttempted = true;
      const res = await fetch("/api/invite/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ email, boardId, boardName, role: inviteRole }),
      });

      const result = await res.json().catch(() => null) as { success?: unknown; accessSaved?: unknown; error?: unknown } | null;
      const savedAccessMessage = result?.accessSaved === true
        ? "Access was saved, but invitation delivery could not be confirmed. Review members and invitations before retrying."
        : null;
      if (!res.ok) {
        toast.error(savedAccessMessage || (typeof result?.error === "string" ? result.error : "Failed to send invite"));
        return;
      }
      if (result?.success !== true) {
        toast.error(savedAccessMessage || "Failed to confirm the invitation. Your email is kept here.");
        return;
      }
      if (!hasOwnerAccess()) return;

      toast.success(`Invitation sent to ${email}`);
      setInviteEmail("");
      onDraftChange?.(false);
    } catch {
      toast.error("Failed to send invite");
    } finally {
      setInviting(false);
      // A rejected or lost response can follow a saved invitation or member.
      // Check the actual access list while keeping an unconfirmed email draft.
      if (requestAttempted) void refreshData();
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!hasOwnerAccess() || loadingDetails) return;
    const { data, error } = await supabase
      .from("board_invites")
      .delete()
      .eq("board_id", boardId)
      .eq("id", inviteId)
      .select("id")
      .maybeSingle();
    if (error || data?.id !== inviteId || !hasOwnerAccess()) {
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
    if (!hasOwnerAccess() || loadingDetails) return;
    const { data, error } = await boardMembers.updateRole(
      boardId,
      memberUserId,
      role,
    );
    if (error || data?.id !== memberId || data.role !== role || !hasOwnerAccess()) {
      toast.error("Failed to update role");
      return;
    }
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, role } : m)),
    );
  };

  const handleRemoveMember = async (memberUserId: string) => {
    if (!hasOwnerAccess() || loadingDetails) return;
    const { data, error } = await supabase
      .from("board_members")
      .delete()
      .eq("board_id", boardId)
      .eq("user_id", memberUserId)
      .select("id")
      .maybeSingle();
    if (error || typeof data?.id !== "string" || !hasOwnerAccess()) {
      toast.error("Failed to remove member");
      return;
    }
    setMembers((prev) => prev.filter((m) => m.user_id !== memberUserId));
    toast.success("Member removed");
  };

  const copyToClipboard = async (text: string, type: "link" | "embed") => {
    if (type === "link") setCopied(false);
    else setEmbedCopied(false);
    try {
      await navigator.clipboard.writeText(text);
      if (type === "link") {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        setEmbedCopied(true);
        setTimeout(() => setEmbedCopied(false), 2000);
      }
    } catch {
      toast.error("Could not copy. Select the text and copy it manually.");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share "{boardName}"</DialogTitle>
        </DialogHeader>
        {!canManage && (
          <p role="alert" className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-[#F2F7F7]">
            Only the board owner can change sharing. Your invitation draft is kept here.
          </p>
        )}
        {canManage && loadingDetails && <p role="status" className="text-sm text-[#A8B2B2]">Loading sharing details…</p>}
        {canManage && loadError && (
          <div role="alert" className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm">
            <p>Could not load sharing details.{detailsLoaded ? ' The last loaded details are still shown.' : ' Try again to view members and invitations.'}</p>
            <Button variant="outline" size="sm" className="mt-2 border-white/10 hover:bg-white/5" disabled={loadingDetails} onClick={() => void refreshData()}>Retry</Button>
          </div>
        )}

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
                aria-label="Public board"
                checked={isPublic}
                disabled={!canManage}
                onCheckedChange={(checked) => { if (hasOwnerAccess()) toggleBoardPublic(boardId, checked); }}
              />
            </div>

            {/* Invite by email */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Invite by email</label>
              <div className="flex gap-2">
                <Input
                  aria-label="Invite email address"
                  type="email"
                  value={inviteEmail}
                  readOnly={!canManage || inviting}
                  onChange={(e) => { setInviteEmail(e.target.value); onDraftChange?.(!!e.target.value.trim()); }}
                  placeholder="Enter email address..."
                  className="flex-1 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
                />
                <Select
                  value={inviteRole}
                  disabled={!canManage || inviting}
                  onValueChange={(v) => setInviteRole(v as MemberRole)}
                >
                  <SelectTrigger aria-label="Invitation role" className="w-28 bg-white/5 border-white/10">
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
                  aria-label="Send invitation"
                  onClick={handleInviteByEmail}
                  disabled={!canManage || !inviteEmail.trim() || inviting}
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
                  aria-label="Shareable link"
                  value={shareUrl}
                  readOnly
                  className="bg-white/5 border-white/10 text-[#A8B2B2] text-sm"
                />
                <Button
                  aria-label={copied ? "Link copied" : "Copy shareable link"}
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
                  aria-label="Enable embedding"
                  checked={embedEnabled}
                  disabled={!canManage}
                  onCheckedChange={(checked) => { if (hasOwnerAccess()) toggleBoardEmbed(boardId, checked); }}
                />
              </div>
              {embedEnabled && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      aria-label="Embed code"
                      value={embedSnippet}
                      readOnly
                      className="bg-white/5 border-white/10 text-[#A8B2B2] text-xs font-mono"
                    />
                    <Button
                      aria-label={embedCopied ? "Embed code copied" : "Copy embed code"}
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
            {canManage && <Button variant="ghost" size="sm" aria-label="Refresh sharing details" className="text-[#A8B2B2] hover:bg-white/5" disabled={loadingDetails} onClick={() => void refreshData()}>Refresh</Button>}
            {/* Owner */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#78fcd6]/20 flex items-center justify-center">
                  <User className="w-4 h-4 text-[#78fcd6]" />
                </div>
                <div>
                  <div className="text-sm font-medium">You</div>
                  <div className="text-xs text-[#A8B2B2]">{canManage ? "Board owner" : "Sharing access changed"}</div>
                </div>
              </div>
              <span className="text-xs text-[#78fcd6] font-medium bg-[#78fcd6]/10 px-2.5 py-1 rounded-full">
                {canManage ? "Owner" : "Read only"}
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
                        disabled={!canManage || loadingDetails}
                        onValueChange={(v) =>
                          handleUpdateRole(
                            member.id,
                            member.user_id,
                            v as MemberRole,
                          )
                        }
                      >
                        <SelectTrigger aria-label={`Role for ${member.profiles?.email || member.profiles?.full_name || "member"}`} className="w-24 h-7 text-xs bg-white/5 border-white/10">
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
                        aria-label={`Remove ${member.profiles?.email || member.profiles?.full_name || "member"}`}
                        disabled={!canManage || loadingDetails}
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
                      aria-label={`Revoke invitation to ${invite.email}`}
                      disabled={!canManage || loadingDetails}
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

            {canManage && detailsLoaded && !loadError && !loadingDetails && members.length === 0 && pendingInvites.length === 0 && (
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
