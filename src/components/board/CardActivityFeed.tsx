import { useState } from 'react';
import { useCardActivities } from '@/hooks/useCards';
import { useBoardStore } from '@/store/useBoardStore';
import type { Json } from '@/types';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MessageSquare, Plus, MoveRight, Edit2, Archive,
  ArchiveRestore, Tag, Calendar, Send, Loader2,
} from 'lucide-react';

interface CardActivityFeedProps {
  cardId: string;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface ActivityData {
  text?: string;
  column?: string;
  from?: string;
  to?: string;
  added?: string[];
  removed?: string[];
}
const ACTIVITY_CONFIG: Record<string, { icon: typeof MessageSquare; format: (data: ActivityData | null | undefined) => string }> = {
  comment: {
    icon: MessageSquare,
    format: (data) => data?.text || '',
  },
  created: {
    icon: Plus,
    format: (data) => `Created this card${data?.column ? ` in ${data.column}` : ''}`,
  },
  moved: {
    icon: MoveRight,
    format: (data) => `Moved from ${data?.from || '?'} to ${data?.to || '?'}`,
  },
  renamed: {
    icon: Edit2,
    format: (data) => `Renamed from "${data?.from || '?'}" to "${data?.to || '?'}"`,
  },
  archived: {
    icon: Archive,
    format: () => 'Archived this card',
  },
  restored: {
    icon: ArchiveRestore,
    format: () => 'Restored this card',
  },
  label_changed: {
    icon: Tag,
    format: (data) => {
      const parts: string[] = [];
      if (data?.added?.length) parts.push(`Added labels: ${data.added.join(', ')}`);
      if (data?.removed?.length) parts.push(`Removed labels: ${data.removed.join(', ')}`);
      return parts.join('. ') || 'Changed labels';
    },
  },
  date_changed: {
    icon: Calendar,
    format: (data) => {
      if (data?.from && data?.to) return `Changed due date from ${data.from} to ${data.to}`;
      if (data?.to) return `Set due date to ${data.to}`;
      if (data?.from) return `Removed due date (was ${data.from})`;
      return 'Changed due date';
    },
  },
};

export function CardActivityFeed({ cardId }: CardActivityFeedProps) {
  const [commentText, setCommentText] = useState('');
  const currentUserId = useBoardStore((s) => s.currentUserId);
  const { activities, isLoading, addActivity, isAddingActivity } = useCardActivities({
    cardId,
    enabled: !!cardId,
  });

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !currentUserId) return;
    try {
      await addActivity({
        user_id: currentUserId,
        type: 'comment',
        data: { text: commentText.trim() } as Json,
      });
      setCommentText('');
    } catch (err) {
      console.error('[activity] comment failed:', err);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Comment Input */}
      <div className="space-y-2 mb-4">
        <Textarea
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Write a comment..."
          className="bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/40 min-h-[60px] resize-none text-sm"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmitComment();
            }
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[#A8B2B2]/60">Ctrl+Enter to send</span>
          <Button
            onClick={handleSubmitComment}
            disabled={!commentText.trim() || isAddingActivity}
            className="gradient-cyan text-[#0B0F0F] hover:opacity-90 disabled:opacity-50 h-7 text-xs px-3"
          >
            {isAddingActivity ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <Send className="w-3.5 h-3.5 mr-1" />
                Comment
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Activity List */}
      <ScrollArea className="flex-1 -mx-1 px-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-[#A8B2B2]" />
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center py-8 text-sm text-[#A8B2B2]">
            No activity yet
          </div>
        ) : (
          <div className="space-y-1">
            {activities.map((activity) => {
              const config = ACTIVITY_CONFIG[activity.type] || {
                icon: MessageSquare,
                format: () => activity.type,
              };
              const Icon = config.icon;
              const isComment = activity.type === 'comment';
              const text = config.format(activity.data as ActivityData | null | undefined);

              return (
                <div
                  key={activity.id}
                  className={`flex gap-2.5 py-2 ${
                    isComment ? 'bg-white/[0.03] rounded-lg px-2.5 -mx-1' : 'px-1'
                  }`}
                >
                  <div className={`flex-shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center ${
                    isComment ? 'bg-[#78fcd6]/10' : 'bg-white/5'
                  }`}>
                    <Icon className={`w-3 h-3 ${isComment ? 'text-[#78fcd6]' : 'text-[#A8B2B2]'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-relaxed ${
                      isComment ? 'text-[#F2F7F7]' : 'text-[#A8B2B2]'
                    }`}>
                      {text}
                    </p>
                    <span className="text-[10px] text-[#A8B2B2]/60">
                      {formatTimeAgo(activity.created_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
