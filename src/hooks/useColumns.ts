import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import * as columnsApi from '../lib/database/columns'
import type { ColumnRow, InsertColumn, UpdateColumn } from '../types/database'

const COLUMNS_KEY = 'columns'

interface UseColumnsOptions {
  boardId: string
  enabled?: boolean
}

export function useColumns({ boardId, enabled = true }: UseColumnsOptions) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: [COLUMNS_KEY, boardId],
    queryFn: async () => {
      const { data, error } = await columnsApi.getAll(boardId)
      if (error) throw error
      return data || []
    },
    enabled: enabled && !!boardId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  })

  // Real-time subscription
  useEffect(() => {
    if (!boardId) return

    const { unsubscribe } = columnsApi.subscribe(boardId, {
      onInsert: (newColumn) => {
        queryClient.setQueryData<ColumnRow[]>([COLUMNS_KEY, boardId], (old) => {
          if (!old) return [newColumn]
          return [...old, newColumn].sort((a, b) => a.order - b.order)
        })
      },
      onUpdate: (updatedColumn) => {
        queryClient.setQueryData<ColumnRow[]>([COLUMNS_KEY, boardId], (old) => {
          if (!old) return [updatedColumn]
          return old
            .map((col) => (col.id === updatedColumn.id ? updatedColumn : col))
            .sort((a, b) => a.order - b.order)
        })
      },
      onDelete: (deletedColumn) => {
        queryClient.setQueryData<ColumnRow[]>([COLUMNS_KEY, boardId], (old) => {
          if (!old) return []
          return old.filter((col) => col.id !== deletedColumn.id)
        })
      },
    })

    return () => {
      unsubscribe()
    }
  }, [boardId, queryClient])

  const createMutation = useMutation({
    mutationFn: async (column: Omit<InsertColumn, 'board_id'>) => {
      // Get the current max order
      const currentColumns = queryClient.getQueryData<ColumnRow[]>([COLUMNS_KEY, boardId]) || []
      const maxOrder = currentColumns.length > 0
        ? Math.max(...currentColumns.map((c) => c.order))
        : -1

      const { data, error } = await columnsApi.create({
        ...column,
        board_id: boardId,
        order: maxOrder + 1,
      })
      if (error) throw error
      return data
    },
    onMutate: async (newColumn) => {
      await queryClient.cancelQueries({ queryKey: [COLUMNS_KEY, boardId] })
      const previousColumns = queryClient.getQueryData<ColumnRow[]>([COLUMNS_KEY, boardId])

      const currentColumns = previousColumns || []
      const maxOrder = currentColumns.length > 0
        ? Math.max(...currentColumns.map((c) => c.order))
        : -1

      const optimisticColumn: ColumnRow = {
        id: crypto.randomUUID(),
        board_id: boardId,
        user_id: newColumn.user_id,
        title: newColumn.title,
        order: maxOrder + 1,
        created_at: new Date().toISOString(),
      }

      queryClient.setQueryData<ColumnRow[]>([COLUMNS_KEY, boardId], (old) => {
        if (!old) return [optimisticColumn]
        return [...old, optimisticColumn].sort((a, b) => a.order - b.order)
      })

      return { previousColumns }
    },
    onError: (_err, _newColumn, context) => {
      if (context?.previousColumns) {
        queryClient.setQueryData([COLUMNS_KEY, boardId], context.previousColumns)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [COLUMNS_KEY, boardId] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: UpdateColumn }) => {
      const { data, error } = await columnsApi.update(id, updates, boardId)
      if (error) throw error
      return data
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: [COLUMNS_KEY, boardId] })
      const previousColumns = queryClient.getQueryData<ColumnRow[]>([COLUMNS_KEY, boardId])

      queryClient.setQueryData<ColumnRow[]>([COLUMNS_KEY, boardId], (old) => {
        if (!old) return []
        return old
          .map((col) => (col.id === id ? { ...col, ...updates } : col))
          .sort((a, b) => a.order - b.order)
      })

      return { previousColumns }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousColumns) {
        queryClient.setQueryData([COLUMNS_KEY, boardId], context.previousColumns)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [COLUMNS_KEY, boardId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await columnsApi.deleteColumn(id, boardId)
      if (error) throw error
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: [COLUMNS_KEY, boardId] })
      const previousColumns = queryClient.getQueryData<ColumnRow[]>([COLUMNS_KEY, boardId])

      queryClient.setQueryData<ColumnRow[]>([COLUMNS_KEY, boardId], (old) => {
        if (!old) return []
        return old.filter((col) => col.id !== id)
      })

      return { previousColumns }
    },
    onError: (_err, _id, context) => {
      if (context?.previousColumns) {
        queryClient.setQueryData([COLUMNS_KEY, boardId], context.previousColumns)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [COLUMNS_KEY, boardId] })
    },
  })

  const reorderMutation = useMutation({
    mutationFn: async (columnIds: string[]) => {
      const { data, error } = await columnsApi.reorder(boardId, columnIds)
      if (error) throw error
      return data
    },
    onMutate: async (columnIds) => {
      await queryClient.cancelQueries({ queryKey: [COLUMNS_KEY, boardId] })
      const previousColumns = queryClient.getQueryData<ColumnRow[]>([COLUMNS_KEY, boardId])

      queryClient.setQueryData<ColumnRow[]>([COLUMNS_KEY, boardId], (old) => {
        if (!old) return []
        return columnIds
          .map((id, index) => {
            const col = old.find((c) => c.id === id)
            return col ? { ...col, order: index } : null
          })
          .filter((col): col is ColumnRow => col !== null)
          .sort((a, b) => a.order - b.order)
      })

      return { previousColumns }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousColumns) {
        queryClient.setQueryData([COLUMNS_KEY, boardId], context.previousColumns)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [COLUMNS_KEY, boardId] })
    },
  })

  return {
    columns: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    createColumn: createMutation.mutateAsync,
    updateColumn: updateMutation.mutateAsync,
    deleteColumn: deleteMutation.mutateAsync,
    reorderColumns: reorderMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isReordering: reorderMutation.isPending,
  }
}
