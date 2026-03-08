import { useState, useRef, useEffect } from 'react';
import { useBoardStore } from '@/store/useBoardStore';
import type { AICommand, AIMessage } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Sparkles, X, Bot, User, Check, AlertCircle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface AIAssistantProps {
  isOpen: boolean;
  onClose: () => void;
}

async function parseCommandWithAI(input: string, context: string): Promise<AICommand | null> {
  try {
    const res = await fetch('/api/ai/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: input, context }),
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (!json || typeof json !== 'object') return null;
    const root = json as Record<string, unknown>;
    const cmd = root.command;
    if (!cmd || typeof cmd !== 'object') return null;
    const v = cmd as Record<string, unknown>;
    if (typeof v.type !== 'string' || typeof v.originalText !== 'string' || typeof v.params !== 'object' || !v.params) {
      return null;
    }
    return {
      type: v.type as AICommand['type'],
      params: v.params as Record<string, unknown>,
      originalText: v.originalText,
    };
  } catch {
    return null;
  }
}

function parseCommandLocal(input: string): AICommand {
  const lower = input.toLowerCase().trim();
  
  // Create board
  if (lower.match(/create (a )?new (board|project)|add (a )?board|make (a )?board/)) {
    const nameMatch = input.match(/(?:called|named|name[d]?\s*["']?)([^"']+)(?:["']|$|\s+(?:for|with|to))/i);
    return {
      type: 'create_board',
      params: { name: nameMatch?.[1]?.trim() || 'New Board' },
      originalText: input,
    };
  }
  
  // Add column
  if (lower.match(/add (a )?column|create (a )?column|new column/)) {
    const nameMatch = input.match(/(?:called|named|title[d]?\s*["']?)([^"']+)(?:["']|$|\s+(?:to|in))/i);
    return {
      type: 'add_column',
      params: { title: nameMatch?.[1]?.trim() || 'New Column' },
      originalText: input,
    };
  }
  
  // Remove column
  if (lower.match(/remove (the )?column|delete (the )?column/)) {
    const nameMatch = input.match(/(?:column\s*["']?)([^"']+)(?:["']|$)/i);
    return {
      type: 'remove_column',
      params: { title: nameMatch?.[1]?.trim() },
      originalText: input,
    };
  }
  
  // Rename column
  if (lower.match(/rename (the )?column/)) {
    const fromMatch = input.match(/(?:from\s*["']?)([^"']+)(?:["']?\s*to)/i);
    const toMatch = input.match(/(?:to\s*["']?)([^"']+)(?:["']|$)/i);
    return {
      type: 'rename_column',
      params: { 
        fromTitle: fromMatch?.[1]?.trim(),
        toTitle: toMatch?.[1]?.trim() || 'Renamed Column'
      },
      originalText: input,
    };
  }
  
  // Add card/task
  if (lower.match(/add (a )?(task|card|item)|create (a )?(task|card)/)) {
    const titleMatch = input.match(/(?:["'])([^"']+)(?:["'])/);
    const toColumnMatch = input.match(/(?:to|in)\s+(?:the\s+)?["']?([^"']+?)(?:["']|\s+column|$)/i);
    return {
      type: 'add_card',
      params: { 
        title: titleMatch?.[1]?.trim() || 'New Task',
        columnTitle: toColumnMatch?.[1]?.trim()
      },
      originalText: input,
    };
  }
  
  // Move card
  if (lower.match(/move (the )?(task|card|item)/)) {
    const titleMatch = input.match(/(?:["'])([^"']+)(?:["'])/);
    const toColumnMatch = input.match(/(?:to|into)\s+(?:the\s+)?["']?([^"']+?)(?:["']|\s+column|$)/i);
    return {
      type: 'move_card',
      params: { 
        cardTitle: titleMatch?.[1]?.trim(),
        toColumnTitle: toColumnMatch?.[1]?.trim()
      },
      originalText: input,
    };
  }
  
  // Remove card
  if (lower.match(/remove (the )?(task|card|item)|delete (the )?(task|card)/)) {
    const titleMatch = input.match(/(?:["'])([^"']+)(?:["'])/);
    return {
      type: 'remove_card',
      params: { title: titleMatch?.[1]?.trim() },
      originalText: input,
    };
  }
  
  // Set target date
  if (lower.match(/set (the )?due date|set (the )?target|due|deadline/)) {
    const titleMatch = input.match(/(?:for\s*["'])([^"']+)(?:["'])/);
    const dateMatch = input.match(/(?:to|on|for)\s+(?:the\s+)?(\w+day|tomorrow|next \w+|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})/i);
    return {
      type: 'set_target_date',
      params: { 
        cardTitle: titleMatch?.[1]?.trim(),
        date: dateMatch?.[1] || 'next week'
      },
      originalText: input,
    };
  }
  
  // Switch view
  if (lower.match(/show (the )?timeline|switch to timeline|timeline view/)) {
    return {
      type: 'switch_view',
      params: { view: 'timeline' },
      originalText: input,
    };
  }
  if (lower.match(/show (the )?board|switch to board|board view|kanban/)) {
    return {
      type: 'switch_view',
      params: { view: 'board' },
      originalText: input,
    };
  }
  
  return {
    type: 'unknown',
    params: {},
    originalText: input,
  };
}

// Quick action suggestions
const QUICK_ACTIONS = [
  "Add task 'Fix navigation' to To Do",
  "Move 'Design review' to Review",
  "Set due Friday for 'Client presentation'",
  "Show the timeline",
];

export function AIAssistant({ isOpen, onClose }: AIAssistantProps) {
  const { 
    activeBoardId, 
    createBoard, 
    addColumn, 
    removeColumn, 
    renameColumn,
    addCard, 
    removeCard, 
    moveCard, 
    editCard,
    setViewMode,
    getActiveBoard,
  } = useBoardStore();
  
  const [messages, setMessages] = useState<AIMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "Hi! I'm your ZeroBoard AI assistant. I can help you manage your boards, columns, and cards using natural language. Try saying:\n\n• " + QUICK_ACTIONS.join('\n• '),
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeBoard = getActiveBoard();

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    void messages[messages.length - 1]?.id;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const executeCommand = (command: AICommand): string => {
    const getString = (key: string) => {
      const value = command.params[key];
      return typeof value === 'string' ? value : undefined;
    };

    switch (command.type) {
      case 'create_board': {
        const name = getString('name') || 'New Board';
        createBoard(name, 'Created via AI');
        return `Created board "${name}"`;
      }
      
      case 'add_column': {
        if (!activeBoardId) return 'No active board. Please select or create a board first.';
        const title = getString('title') || 'New Column';
        addColumn(activeBoardId, title);
        return `Added column "${title}"`;
      }
      
      case 'remove_column': {
        if (!activeBoardId) return 'No active board.';
        const title = getString('title');
        const column = activeBoard?.columns.find(c => 
          title ? c.title.toLowerCase() === title.toLowerCase() : false
        );
        if (!column) return title ? `Column "${title}" not found.` : 'Column not found.';
        removeColumn(activeBoardId, column.id);
        return title ? `Removed column "${title}"` : `Removed column "${column.title}"`;
      }
      
      case 'rename_column': {
        if (!activeBoardId) return 'No active board.';
        const fromTitle = getString('fromTitle');
        const toTitle = getString('toTitle') || 'Renamed Column';
        const column = activeBoard?.columns.find(c => (fromTitle ? c.title.toLowerCase() === fromTitle.toLowerCase() : false));
        if (!column) return fromTitle ? `Column "${fromTitle}" not found.` : 'Column not found.';
        renameColumn(activeBoardId, column.id, toTitle);
        return `Renamed column to "${toTitle}"`;
      }
      
      case 'add_card': {
        if (!activeBoardId) return 'No active board.';
        let columnId = activeBoard?.columns[0]?.id;

        const title = getString('title') || 'New Task';
        const columnTitle = getString('columnTitle');

        if (columnTitle) {
          const column = activeBoard?.columns.find(c => 
            c.title.toLowerCase().includes(columnTitle.toLowerCase())
          );
          if (column) columnId = column.id;
        }
        
        if (!columnId) return 'No column found to add the card to.';
        addCard(activeBoardId, columnId, title, { type: 'text', text: '' });
        return `Added card "${title}"`;
      }
      
      case 'remove_card': {
        if (!activeBoardId) return 'No active board.';
        let removed = false;
        const title = getString('title');
        activeBoard?.columns.forEach(column => {
          const card = column.cards.find(c => 
            title ? c.title.toLowerCase().includes(title.toLowerCase()) : false
          );
          if (card) {
            removeCard(activeBoardId, column.id, card.id);
            removed = true;
          }
        });
        if (!title) return removed ? 'Removed card.' : 'Card not found.';
        return removed ? `Removed card "${title}"` : `Card "${title}" not found.`;
      }
      
      case 'move_card': {
        if (!activeBoardId) return 'No active board.';
        
        let sourceColumnId: string | undefined;
        let cardId: string | undefined;
        const cardTitle = getString('cardTitle');
        const toColumnTitle = getString('toColumnTitle');
        
        activeBoard?.columns.forEach(column => {
          const card = column.cards.find(c => 
            cardTitle ? c.title.toLowerCase().includes(cardTitle.toLowerCase()) : false
          );
          if (card) {
            sourceColumnId = column.id;
            cardId = card.id;
          }
        });
        
        if (!cardId) return cardTitle ? `Card "${cardTitle}" not found.` : 'Card not found.';
        
        const targetColumn = activeBoard?.columns.find(c => 
          toColumnTitle ? c.title.toLowerCase().includes(toColumnTitle.toLowerCase()) : false
        );
        if (!targetColumn) return toColumnTitle ? `Column "${toColumnTitle}" not found.` : 'Column not found.';
        
        moveCard(activeBoardId, sourceColumnId!, targetColumn.id, cardId);
        return `Moved "${cardTitle || 'card'}" to ${targetColumn.title}`;
      }
      
      case 'set_target_date': {
        if (!activeBoardId) return 'No active board.';
        
        // Parse date
        let targetDate: string;
        const dateStr = getString('date')?.toLowerCase();
        if (dateStr === 'tomorrow') {
          targetDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        } else if (dateStr === 'friday') {
          const today = new Date();
          const daysUntilFriday = (5 - today.getDay() + 7) % 7 || 7;
          const friday = new Date(today.getTime() + daysUntilFriday * 86400000);
          targetDate = friday.toISOString().split('T')[0];
        } else if (dateStr?.match(/^\d{4}-\d{2}-\d{2}$/)) {
          targetDate = dateStr;
        } else {
          targetDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
        }
        
        let updated = false;
        const cardTitle = getString('cardTitle');
        activeBoard?.columns.forEach(column => {
          const card = column.cards.find(c => 
            cardTitle ? c.title.toLowerCase().includes(cardTitle.toLowerCase()) : false
          );
          if (card) {
            editCard(activeBoardId, column.id, card.id, { targetDate });
            updated = true;
          }
        });
        
        if (!cardTitle) return updated ? `Set due date to ${targetDate}` : 'Card not found.';
        return updated
          ? `Set due date for "${cardTitle}" to ${targetDate}`
          : `Card "${cardTitle}" not found.`;
      }
      
      case 'switch_view': {
        const view = getString('view');
        if (view !== 'board' && view !== 'timeline') return 'Unknown view.';
        setViewMode(view);
        return `Switched to ${view} view`;
      }
      
      default:
        return "I'm not sure how to help with that. Try commands like:\n• Add task 'Title' to Column\n• Move 'Title' to Column\n• Set due Friday for 'Title'\n• Show the timeline";
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isProcessing) return;

    const userMessage: AIMessage = {
      id: uuidv4(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsProcessing(true);

    const boardContext = (() => {
      if (!activeBoard) return '';
      const snapshot = {
        boardName: activeBoard.name,
        columns: activeBoard.columns.map((c) => ({
          title: c.title,
          cards: c.cards.filter((x) => !x.isArchived).map((x) => x.title),
        })),
      };
      return JSON.stringify(snapshot);
    })();

    const command = (await parseCommandWithAI(userMessage.content, boardContext)) ?? parseCommandLocal(userMessage.content);
    
    // Simulate processing delay for better UX
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const result = executeCommand(command);
    
    const assistantMessage: AIMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: result,
      timestamp: new Date().toISOString(),
      command,
    };

    setMessages(prev => [...prev, assistantMessage]);
    setIsProcessing(false);
  };

  const handleQuickAction = (action: string) => {
    setInput(action);
    setTimeout(() => handleSend(), 50);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:justify-end p-1 sm:p-4 pointer-events-none">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close AI assistant"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto"
        onClick={onClose}
      />
      
      {/* Chat Panel */}
      <div className="relative w-full sm:max-w-md h-[calc(100dvh-1rem)] sm:h-[600px] bg-[#111515] border border-white/10 rounded-2xl shadow-2xl flex flex-col pointer-events-auto overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#0B0F0F]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg gradient-cyan flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-[#0B0F0F]" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">AI Assistant</h3>
              <p className="text-xs text-[#A8B2B2]">Natural language commands</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-3 hover:bg-white/5 rounded-lg text-[#A8B2B2] hover:text-[#F2F7F7] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  message.role === 'user' 
                    ? 'bg-white/10' 
                    : 'gradient-cyan'
                }`}>
                  {message.role === 'user' ? (
                    <User className="w-4 h-4 text-[#F2F7F7]" />
                  ) : (
                    <Bot className="w-4 h-4 text-[#0B0F0F]" />
                  )}
                </div>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                  message.role === 'user'
                    ? 'bg-[#78fcd6]/20 text-[#F2F7F7] rounded-br-md'
                    : 'bg-white/5 text-[#F2F7F7] rounded-bl-md'
                }`}>
                  {message.command?.type === 'unknown' && message.role === 'assistant' ? (
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                      <span>{message.content}</span>
                    </div>
                  ) : message.command && message.role === 'assistant' ? (
                    <div className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-[#78fcd6] flex-shrink-0 mt-0.5" />
                      <span>{message.content}</span>
                    </div>
                  ) : (
                    <div className="whitespace-pre-line">{message.content}</div>
                  )}
                </div>
              </div>
            ))}
            {isProcessing && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg gradient-cyan flex items-center justify-center">
                  <Bot className="w-4 h-4 text-[#0B0F0F]" />
                </div>
                <div className="bg-white/5 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-[#78fcd6] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-[#78fcd6] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-[#78fcd6] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Quick Actions */}
        <div className="px-4 py-2 border-t border-white/5 bg-[#0B0F0F]/50">
          <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-2">
            {QUICK_ACTIONS.map((action) => (
              <button
                type="button"
                key={action}
                onClick={() => handleQuickAction(action)}
                className="flex-shrink-0 text-xs px-3 py-1.5 border border-[#78fcd6]/30 rounded-full hover:bg-[#78fcd6]/10 hover:border-[#78fcd6]/50 transition-all duration-300 bg-gradient-to-r from-black/20 to-transparent backdrop-blur-sm text-[#78fcd6] font-medium"
              >
                {action.length > 20 ? action.slice(0, 20) + '...' : action}
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <div className="p-4 border-t border-white/10 bg-[#0B0F0F]">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="What should we do next?"
              className="flex-1 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50 h-11 sm:h-10 text-base sm:text-sm"
              disabled={isProcessing}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isProcessing}
              className="h-11 w-11 sm:h-10 sm:w-10 p-0 gradient-cyan text-[#0B0F0F] hover:opacity-90 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
