import { useCallback } from 'react';
import { useBoardStore } from '@/store/useBoardStore';
import * as cardsApi from '@/lib/database/cards';

export function useActivityLogger() {
  const currentUserId = useBoardStore((s) => s.currentUserId);

  const logActivity = useCallback(
    (cardId: string, type: string, data: Record<string, unknown> = {}) => {
      if (!currentUserId) return;
      cardsApi.addActivity({
        card_id: cardId,
        user_id: currentUserId,
        type,
        data: data as any,
      }).then(({ error }) => {
        if (error) console.error('[activity] log failed:', error.message);
      });
    },
    [currentUserId]
  );

  return { logActivity };
}
