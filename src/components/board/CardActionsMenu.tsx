import { useMemo } from 'react';
import { useBoardStore } from '@/store/useBoardStore';
import type { Column } from '@/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Archive, Copy, Edit2, MoreHorizontal, MoveRight, Trash2 } from 'lucide-react';

interface CardActionsMenuProps {
  boardId: string;
  columnId: string;
  cardId: string;
  columns: Column[];
  onEdit: () => void;
}

export function CardActionsMenu({ boardId, columnId, cardId, columns, onEdit }: CardActionsMenuProps) {
  const { removeCard, duplicateCard, archiveCard, moveCard } = useBoardStore();

  const moveTargets = useMemo(() => columns.filter((c) => c.id !== columnId), [columns, columnId]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 bg-[#111515] border-white/10 text-[#F2F7F7]">
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="hover:bg-white/5 cursor-pointer focus:bg-white/5 text-xs"
        >
          <Edit2 className="w-3.5 h-3.5" />
          Edit
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            duplicateCard(boardId, columnId, cardId);
          }}
          className="hover:bg-white/5 cursor-pointer focus:bg-white/5 text-xs"
        >
          <Copy className="w-3.5 h-3.5" />
          Duplicate
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="hover:bg-white/5 focus:bg-white/5 text-xs">
            <MoveRight className="w-3.5 h-3.5" />
            Move to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="bg-[#111515] border-white/10 text-[#F2F7F7]">
            {moveTargets.length === 0 ? (
              <DropdownMenuItem disabled className="text-xs opacity-60">
                No other columns
              </DropdownMenuItem>
            ) : (
              moveTargets.map((target) => (
                <DropdownMenuItem
                  key={target.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    moveCard(boardId, columnId, target.id, cardId);
                  }}
                  className="hover:bg-white/5 cursor-pointer focus:bg-white/5 text-xs"
                >
                  {target.title}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            archiveCard(boardId, columnId, cardId);
          }}
          className="hover:bg-white/5 cursor-pointer focus:bg-white/5 text-xs"
        >
          <Archive className="w-3.5 h-3.5" />
          Archive
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-white/10" />

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            removeCard(boardId, columnId, cardId);
          }}
          className="text-red-400 hover:bg-red-500/10 cursor-pointer focus:bg-red-500/10 focus:text-red-400 text-xs"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
