import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import * as boardsApi from '../lib/database/boards'
import type { BoardRow, InsertBoard, UpdateBoard } from '../types/database'

const BOARDS_KEY = 'boards'

interface UseBoardsOptions {
  userId: string
  enabled?: boolean
}

export function useBoards({ userId, enabled = true }: UseBoardsOptions) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: [BOARDS_KEY, userId],
    queryFn: async () => {
      const { data, error } = await boardsApi.getAll(userId)
      if (error) throw error
      return data || []
    },
    enabled: enabled && !!userId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  // Real-time subscription
  useEffect(() => {
    if (!userId) return

    const { unsubscribe } = boardsApi.subscribe(userId, {
      onInsert: (newBoard) => {
        queryClient.setQueryData<BoardRow[]>([BOARDS_KEY, userId], (old) => {
          if (!old) return [newBoard]
          return [newBoard, ...old]
        })
      },
      onUpdate: (updatedBoard) => {
        queryClient.setQueryData<BoardRow[]>([BOARDS_KEY, userId], (old) => {
          if (!old) return [updatedBoard]
          return old.map((board) =>
            board.id === updatedBoard.id ? updatedBoard : board
          )
        })
      },
      onDelete: (deletedBoard) => {
        queryClient.setQueryData<BoardRow[]>([BOARDS_KEY, userId], (old) => {
          if (!old) return []
          return old.filter((board) => board.id !== deletedBoard.id)
        })
      },
    })

    return () => {
      unsubscribe()
    }
  }, [userId, queryClient])

  const createMutation = useMutation({
    mutationFn: async (board: Omit<InsertBoard, 'user_id'>) => {
      const { data, error } = await boardsApi.create({
        ...board,
        user_id: userId,
      })
      if (error) throw error
      return data
    },
    onMutate: async (newBoard) => {
      await queryClient.cancelQueries({ queryKey: [BOARDS_KEY, userId] })
      const previousBoards = queryClient.getQueryData<BoardRow[]>([BOARDS_KEY, userId])

      const optimisticBoard: BoardRow = {
        id: crypto.randomUUID(),
        user_id: userId,
        name: newBoard.name,
        description: newBoard.description || null,
        data: { columns: [] },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      queryClient.setQueryData<BoardRow[]>([BOARDS_KEY, userId], (old) => {
        if (!old) return [optimisticBoard]
        return [optimisticBoard, ...old]
      })

      return { previousBoards }
    },
    onError: (_err, _newBoard, context) => {
      if (context?.previousBoards) {
        queryClient.setQueryData([BOARDS_KEY, userId], context.previousBoards)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [BOARDS_KEY, userId] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: UpdateBoard }) => {
      const { data, error } = await boardsApi.update(id, updates, userId)
      if (error) throw error
      return data
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: [BOARDS_KEY, userId] })
      const previousBoards = queryClient.getQueryData<BoardRow[]>([BOARDS_KEY, userId])

      queryClient.setQueryData<BoardRow[]>([BOARDS_KEY, userId], (old) => {
        if (!old) return []
        return old.map((board) =>
          board.id === id
            ? { ...board, ...updates, updated_at: new Date().toISOString() }
            : board
        )
      })

      return { previousBoards }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousBoards) {
        queryClient.setQueryData([BOARDS_KEY, userId], context.previousBoards)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [BOARDS_KEY, userId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await boardsApi.deleteBoard(id, userId)
      if (error) throw error
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: [BOARDS_KEY, userId] })
      const previousBoards = queryClient.getQueryData<BoardRow[]>([BOARDS_KEY, userId])

      queryClient.setQueryData<BoardRow[]>([BOARDS_KEY, userId], (old) => {
        if (!old) return []
        return old.filter((board) => board.id !== id)
      })

      return { previousBoards }
    },
    onError: (_err, _id, context) => {
      if (context?.previousBoards) {
        queryClient.setQueryData([BOARDS_KEY, userId], context.previousBoards)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [BOARDS_KEY, userId] })
    },
  })

  return {
    boards: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    createBoard: createMutation.mutateAsync,
    updateBoard: updateMutation.mutateAsync,
    deleteBoard: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
