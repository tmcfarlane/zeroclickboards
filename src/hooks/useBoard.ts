import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import * as boardsApi from '../lib/database/boards'
import type { BoardRow, UpdateBoard } from '../types/database'

const BOARD_KEY = 'board'

interface UseBoardOptions {
  boardId: string
  userId: string
  enabled?: boolean
}

export function useBoard({ boardId, userId, enabled = true }: UseBoardOptions) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: [BOARD_KEY, boardId],
    queryFn: async () => {
      const { data, error } = await boardsApi.getById(boardId, userId)
      if (error) throw error
      return data
    },
    enabled: enabled && !!boardId && !!userId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  // Real-time subscription for this specific board
  useEffect(() => {
    if (!boardId || !userId) return

    const { unsubscribe } = boardsApi.subscribe(userId, {
      onUpdate: (updatedBoard) => {
        if (updatedBoard.id === boardId) {
          queryClient.setQueryData<BoardRow>([BOARD_KEY, boardId], updatedBoard)
        }
      },
      onDelete: (deletedBoard) => {
        if (deletedBoard.id === boardId) {
          queryClient.removeQueries({ queryKey: [BOARD_KEY, boardId] })
        }
      },
    })

    return () => {
      unsubscribe()
    }
  }, [boardId, userId, queryClient])

  const updateMutation = useMutation({
    mutationFn: async (updates: UpdateBoard) => {
      const { data, error } = await boardsApi.update(boardId, updates, userId)
      if (error) throw error
      return data
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: [BOARD_KEY, boardId] })
      const previousBoard = queryClient.getQueryData<BoardRow>([BOARD_KEY, boardId])

      queryClient.setQueryData<BoardRow>([BOARD_KEY, boardId], (old) => {
        if (!old) return undefined
        return { ...old, ...updates, updated_at: new Date().toISOString() }
      })

      return { previousBoard }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousBoard) {
        queryClient.setQueryData([BOARD_KEY, boardId], context.previousBoard)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [BOARD_KEY, boardId] })
      // Also invalidate the boards list
      queryClient.invalidateQueries({ queryKey: ['boards', userId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await boardsApi.deleteBoard(boardId, userId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: [BOARD_KEY, boardId] })
      // Invalidate the boards list
      queryClient.invalidateQueries({ queryKey: ['boards', userId] })
    },
  })

  return {
    board: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    updateBoard: updateMutation.mutateAsync,
    deleteBoard: deleteMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
