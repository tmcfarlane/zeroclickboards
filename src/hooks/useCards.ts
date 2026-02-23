import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import * as cardsApi from '../lib/database/cards'
import type { CardRow, InsertCard, UpdateCard, CardActivity, InsertCardActivity } from '../types/database'

const CARDS_KEY = 'cards'
const CARD_ACTIVITIES_KEY = 'card-activities'

interface UseCardsOptions {
  boardId: string
  columnId?: string
  includeArchived?: boolean
  enabled?: boolean
}

export function useCards({ boardId, columnId, includeArchived = false, enabled = true }: UseCardsOptions) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: [CARDS_KEY, boardId, columnId, includeArchived],
    queryFn: async () => {
      const { data, error } = await cardsApi.getAll(boardId, {
        columnId,
        includeArchived,
      })
      if (error) throw error
      return data || []
    },
    enabled: enabled && !!boardId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  })

  // Real-time subscription
  useEffect(() => {
    if (!boardId) return

    const { unsubscribe } = cardsApi.subscribe(boardId, {
      onInsert: (newCard) => {
        queryClient.setQueryData<CardRow[]>([CARDS_KEY, boardId, columnId, includeArchived], (old) => {
          if (!old) return [newCard]
          // Only add if it matches our filters
          if (columnId && newCard.column_id !== columnId) return old
          if (!includeArchived && newCard.is_archived) return old
          return [...old, newCard].sort((a, b) => a.order - b.order)
        })
      },
      onUpdate: (updatedCard) => {
        queryClient.setQueryData<CardRow[]>([CARDS_KEY, boardId, columnId, includeArchived], (old) => {
          if (!old) return []
          return old
            .map((card) => (card.id === updatedCard.id ? updatedCard : card))
            .filter((card) => {
              // Remove if no longer matches filters
              if (columnId && card.column_id !== columnId) return false
              if (!includeArchived && card.is_archived) return false
              return true
            })
            .sort((a, b) => a.order - b.order)
        })
      },
      onDelete: (deletedCard) => {
        queryClient.setQueryData<CardRow[]>([CARDS_KEY, boardId, columnId, includeArchived], (old) => {
          if (!old) return []
          return old.filter((card) => card.id !== deletedCard.id)
        })
      },
    })

    return () => {
      unsubscribe()
    }
  }, [boardId, columnId, includeArchived, queryClient])

  const createMutation = useMutation({
    mutationFn: async (card: Omit<InsertCard, 'board_id' | 'order'>) => {
      // Get the current max order for the column
      const currentCards = queryClient.getQueryData<CardRow[]>([CARDS_KEY, boardId, card.column_id, includeArchived]) || []
      const maxOrder = currentCards.length > 0
        ? Math.max(...currentCards.map((c) => c.order))
        : -1

      const { data, error } = await cardsApi.create({
        ...card,
        board_id: boardId,
        order: maxOrder + 1,
      })
      if (error) throw error
      return data
    },
    onMutate: async (newCard) => {
      const queryKey = [CARDS_KEY, boardId, newCard.column_id, includeArchived]
      await queryClient.cancelQueries({ queryKey })
      const previousCards = queryClient.getQueryData<CardRow[]>(queryKey)

      const currentCards = previousCards || []
      const maxOrder = currentCards.length > 0
        ? Math.max(...currentCards.map((c) => c.order))
        : -1

      const optimisticCard: CardRow = {
        id: crypto.randomUUID(),
        board_id: boardId,
        column_id: newCard.column_id,
        user_id: newCard.user_id,
        title: newCard.title,
        content: newCard.content || null,
        target_date: newCard.target_date || null,
        labels: newCard.labels || null,
        cover_image: newCard.cover_image || null,
        order: maxOrder + 1,
        is_archived: newCard.is_archived || false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      queryClient.setQueryData<CardRow[]>(queryKey, (old) => {
        if (!old) return [optimisticCard]
        return [...old, optimisticCard].sort((a, b) => a.order - b.order)
      })

      return { previousCards, queryKey }
    },
    onError: (_err, _newCard, context) => {
      if (context?.previousCards) {
        queryClient.setQueryData(context.queryKey, context.previousCards)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: [CARDS_KEY, boardId, variables.column_id, includeArchived],
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: UpdateCard }) => {
      const { data, error } = await cardsApi.update(id, updates, boardId)
      if (error) throw error
      return data
    },
    onMutate: async ({ id, updates }) => {
      const queryKey = [CARDS_KEY, boardId, columnId, includeArchived]
      await queryClient.cancelQueries({ queryKey })
      const previousCards = queryClient.getQueryData<CardRow[]>(queryKey)

      queryClient.setQueryData<CardRow[]>(queryKey, (old) => {
        if (!old) return []
        return old
          .map((card) => (card.id === id ? { ...card, ...updates, updated_at: new Date().toISOString() } : card))
          .sort((a, b) => a.order - b.order)
      })

      return { previousCards, queryKey }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousCards) {
        queryClient.setQueryData(context.queryKey, context.previousCards)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [CARDS_KEY, boardId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await cardsApi.deleteCard(id, boardId)
      if (error) throw error
    },
    onMutate: async (id) => {
      const queryKey = [CARDS_KEY, boardId, columnId, includeArchived]
      await queryClient.cancelQueries({ queryKey })
      const previousCards = queryClient.getQueryData<CardRow[]>(queryKey)

      queryClient.setQueryData<CardRow[]>(queryKey, (old) => {
        if (!old) return []
        return old.filter((card) => card.id !== id)
      })

      return { previousCards, queryKey }
    },
    onError: (_err, _id, context) => {
      if (context?.previousCards) {
        queryClient.setQueryData(context.queryKey, context.previousCards)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [CARDS_KEY, boardId] })
    },
  })

  const moveMutation = useMutation({
    mutationFn: async ({
      id,
      newColumnId,
      newOrder,
    }: {
      id: string
      newColumnId: string
      newOrder: number
    }) => {
      const { data, error } = await cardsApi.move(id, boardId, newColumnId, newOrder)
      if (error) throw error
      return data
    },
    onMutate: async ({ id, newColumnId, newOrder }) => {
      const oldQueryKey = [CARDS_KEY, boardId, columnId, includeArchived]
      const newQueryKey = [CARDS_KEY, boardId, newColumnId, includeArchived]

      await queryClient.cancelQueries({ queryKey: oldQueryKey })
      await queryClient.cancelQueries({ queryKey: newQueryKey })

      const previousOldCards = queryClient.getQueryData<CardRow[]>(oldQueryKey)
      const previousNewCards = queryClient.getQueryData<CardRow[]>(newQueryKey)

      // Remove from old column
      let movedCard: CardRow | undefined
      queryClient.setQueryData<CardRow[]>(oldQueryKey, (old) => {
        if (!old) return []
        movedCard = old.find((c) => c.id === id)
        return old.filter((c) => c.id !== id)
      })

      // Add to new column
      if (movedCard) {
        queryClient.setQueryData<CardRow[]>(newQueryKey, (old) => {
          const cards = old || []
          const updatedCard = { ...movedCard!, column_id: newColumnId, order: newOrder }
          return [...cards, updatedCard].sort((a, b) => a.order - b.order)
        })
      }

      return { previousOldCards, previousNewCards, oldQueryKey, newQueryKey }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousOldCards) {
        queryClient.setQueryData(context.oldQueryKey, context.previousOldCards)
      }
      if (context?.previousNewCards) {
        queryClient.setQueryData(context.newQueryKey, context.previousNewCards)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [CARDS_KEY, boardId] })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await cardsApi.archive(id, boardId)
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CARDS_KEY, boardId] })
    },
  })

  const unarchiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await cardsApi.unarchive(id, boardId)
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CARDS_KEY, boardId] })
    },
  })

  return {
    cards: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    createCard: createMutation.mutateAsync,
    updateCard: updateMutation.mutateAsync,
    deleteCard: deleteMutation.mutateAsync,
    moveCard: moveMutation.mutateAsync,
    archiveCard: archiveMutation.mutateAsync,
    unarchiveCard: unarchiveMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isMoving: moveMutation.isPending,
    isArchiving: archiveMutation.isPending,
    isUnarchiving: unarchiveMutation.isPending,
  }
}

// Hook for card activities
interface UseCardActivitiesOptions {
  cardId: string
  enabled?: boolean
}

export function useCardActivities({ cardId, enabled = true }: UseCardActivitiesOptions) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: [CARD_ACTIVITIES_KEY, cardId],
    queryFn: async () => {
      const { data, error } = await cardsApi.getActivities(cardId)
      if (error) throw error
      return data || []
    },
    enabled: enabled && !!cardId,
  })

  // Real-time subscription for activities
  useEffect(() => {
    if (!cardId) return

    const { unsubscribe } = cardsApi.subscribeToActivities(cardId, (newActivity) => {
      queryClient.setQueryData<CardActivity[]>([CARD_ACTIVITIES_KEY, cardId], (old) => {
        if (!old) return [newActivity]
        return [newActivity, ...old]
      })
    })

    return () => {
      unsubscribe()
    }
  }, [cardId, queryClient])

  const addActivityMutation = useMutation({
    mutationFn: async (activity: Omit<InsertCardActivity, 'card_id'>) => {
      const { data, error } = await cardsApi.addActivity({
        ...activity,
        card_id: cardId,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CARD_ACTIVITIES_KEY, cardId] })
    },
  })

  return {
    activities: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    addActivity: addActivityMutation.mutateAsync,
    isAddingActivity: addActivityMutation.isPending,
  }
}
