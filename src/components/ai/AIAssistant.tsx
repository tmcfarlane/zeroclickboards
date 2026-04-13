import { useState, useRef, useEffect } from "react";
import { useBoardStore } from "@/store/useBoardStore";
import { useAuthContext } from "@/components/auth/AuthProvider";
import type { AICommand, AIMessage } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Send,
  Sparkles,
  X,
  Bot,
  User,
  Check,
  AlertCircle,
  Trash2,
  Zap,
  Crown,
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { useAIUsage } from "@/hooks/useAIUsage";

interface AIAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgrade?: () => void;
}

function validateCommand(v: unknown): AICommand | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  if (
    typeof obj.type !== "string" ||
    typeof obj.originalText !== "string" ||
    typeof obj.params !== "object" ||
    !obj.params
  ) {
    return null;
  }
  return {
    type: obj.type as AICommand["type"],
    params: obj.params as Record<string, unknown>,
    originalText: obj.originalText,
  };
}

interface AIResponse {
  commands: AICommand[] | null;
  usage?: {
    used: number;
    limit: number | null;
    warning?: boolean;
    resetsAt?: string;
  };
  limitReached?: boolean;
}

async function parseCommandWithAI(
  input: string,
  context: string,
  lastCommand?: { type: string; params: Record<string, unknown> },
  accessToken?: string | null,
): Promise<AIResponse> {
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }
    const res = await fetch("/api/ai/command", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: input, context, lastCommand }),
    });

    if (res.status === 429) {
      const json = (await res.json()) as Record<string, unknown>;
      const usage = json.usage as
        | { used: number; limit: number; warning?: boolean; resetsAt?: string }
        | undefined;
      return { commands: null, usage: usage ?? undefined, limitReached: true };
    }

    if (res.status === 403) {
      return {
        commands: [
          {
            type: "unknown",
            params: {},
            originalText: "AI_SUBSCRIPTION_REQUIRED",
          },
        ],
      };
    }
    if (!res.ok) return { commands: null };
    const json: unknown = await res.json();
    if (!json || typeof json !== "object") return { commands: null };
    const root = json as Record<string, unknown>;

    if (root.timing) {
      console.log("[AI Command] Server timing:", root.timing);
    }

    const usage = root.usage as
      | { used: number; limit: number | null; warning?: boolean }
      | undefined;

    // Batch response: { commands: [...] }
    if (Array.isArray(root.commands)) {
      const validated = root.commands
        .map(validateCommand)
        .filter((c): c is AICommand => c !== null);
      return {
        commands: validated.length > 0 ? validated : null,
        usage: usage ?? undefined,
      };
    }

    // Single response: { command: {...} }
    const cmd = validateCommand(root.command);
    return { commands: cmd ? [cmd] : null, usage: usage ?? undefined };
  } catch {
    return { commands: null };
  }
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const SAMPLE_TASKS = [
  "Update documentation",
  "Fix navigation bug",
  "Design landing page",
  "Write unit tests",
  "Review pull request",
  "Optimize database queries",
  "Set up CI/CD pipeline",
  "Create onboarding flow",
  "Refactor auth module",
  "Add dark mode toggle",
  "Implement search feature",
  "Update dependencies",
  "Fix responsive layout",
  "Add error handling",
  "Create API endpoints",
  "Write integration tests",
  "Design email templates",
  "Set up monitoring",
  "Add accessibility audit",
  "Optimize page load time",
  "Create user settings page",
  "Build notification system",
  "Add file upload support",
  "Write migration scripts",
  "Configure logging",
  "Add rate limiting",
  "Create admin dashboard",
  "Implement caching layer",
  "Add OAuth providers",
  "Set up staging environment",
];

function pickRandomTasks(count: number): string[] {
  const shuffled = [...SAMPLE_TASKS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function parseCommandLocal(input: string): AICommand[] {
  const lower = input.toLowerCase().trim();

  // --- Batch creation: "Add 10 random tasks to TODO" or "Add 5 cards to Done" ---
  const batchCountMatch = lower.match(
    /(?:add|create|make|generate)\s+(\d+)\s+(?:random\s+)?(?:tasks?|cards?|items?|todos?)/,
  );
  if (batchCountMatch) {
    const count = Math.min(parseInt(batchCountMatch[1], 10), 30);
    const toColumnMatch = input.match(
      /(?:to|in|into)\s+(?:the\s+)?["']?([^"']+?)(?:["']|\s+column|$)/i,
    );
    const columnTitle = toColumnMatch?.[1]?.trim();
    const titles = pickRandomTasks(count);
    return titles.map((title) => ({
      type: "add_card" as const,
      params: { title, columnTitle },
      originalText: input,
    }));
  }

  // --- Batch named tasks: "Add tasks: design, build, test to TODO" ---
  const batchListMatch = input.match(
    /(?:add|create|make)\s+(?:tasks?|cards?|items?)[:\s]+([\s\S]+?)(?:\s+(?:to|in|into)\s+(?:the\s+)?["']?([^"']+?)(?:["']|\s+column|$)|$)/i,
  );
  if (
    batchListMatch &&
    !lower.match(/(?:add|create|make)\s+(?:a\s+)?(?:task|card|item)\s/)
  ) {
    const items = batchListMatch[1]
      .split(/,|;/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length > 1) {
      const columnTitle = batchListMatch[2]?.trim();
      return items.map((title) => ({
        type: "add_card" as const,
        params: { title, columnTitle },
        originalText: input,
      }));
    }
  }

  // --- Clear column: "Clear TODO", "Empty the Done column" ---
  if (
    lower.match(
      /(?:clear|empty|wipe)\s+(?:the\s+)?(?:["']?([^"']+?)["']?\s+)?(?:column|list)?/i,
    ) &&
    lower.match(/(?:clear|empty|wipe)/)
  ) {
    const colMatch = input.match(
      /(?:clear|empty|wipe)\s+(?:the\s+)?["']?([^"']+?)["']?(?:\s+column|\s+list)?$/i,
    );
    return [
      {
        type: "clear_column",
        params: { columnTitle: colMatch?.[1]?.trim() },
        originalText: input,
      },
    ];
  }

  // --- Count cards: "How many cards in Done?", "Count tasks" ---
  if (lower.match(/(?:how many|count|total)\s+(?:cards?|tasks?|items?)/)) {
    const colMatch = input.match(
      /(?:in|from)\s+(?:the\s+)?["']?([^"'?]+?)["']?(?:\s+column)?[?]?$/i,
    );
    return [
      {
        type: "count_cards",
        params: { columnTitle: colMatch?.[1]?.trim() },
        originalText: input,
      },
    ];
  }

  // --- Rename card: "Rename card 'X' to 'Y'" ---
  if (lower.match(/rename\s+(?:the\s+)?(?:card|task|item)/)) {
    const titles = [...input.matchAll(/["']([^"']+)["']/g)];
    return [
      {
        type: "rename_card",
        params: {
          cardTitle: titles[0]?.[1]?.trim(),
          newTitle: titles[1]?.[1]?.trim(),
        },
        originalText: input,
      },
    ];
  }

  // Create board
  if (
    lower.match(
      /create (a )?new (board|project)|add (a )?board|make (a )?board/,
    )
  ) {
    const nameMatch = input.match(
      /(?:called|named|name[d]?\s*["']?)([^"']+)(?:["']|$|\s+(?:for|with|to))/i,
    );
    return [
      {
        type: "create_board",
        params: { name: nameMatch?.[1]?.trim() || "New Board" },
        originalText: input,
      },
    ];
  }

  // Add column
  if (lower.match(/add (a )?column|create (a )?column|new column/)) {
    const nameMatch = input.match(
      /(?:called|named|title[d]?\s*["']?)([^"']+)(?:["']|$|\s+(?:to|in))/i,
    );
    return [
      {
        type: "add_column",
        params: { title: nameMatch?.[1]?.trim() || "New Column" },
        originalText: input,
      },
    ];
  }

  // Remove column
  if (lower.match(/remove (the )?column|delete (the )?column/)) {
    const nameMatch = input.match(/(?:column\s*["']?)([^"']+)(?:["']|$)/i);
    return [
      {
        type: "remove_column",
        params: { title: nameMatch?.[1]?.trim() },
        originalText: input,
      },
    ];
  }

  // Rename column
  if (lower.match(/rename (the )?column/)) {
    const fromMatch = input.match(/(?:from\s*["']?)([^"']+)(?:["']?\s*to)/i);
    const toMatch = input.match(/(?:to\s*["']?)([^"']+)(?:["']|$)/i);
    return [
      {
        type: "rename_column",
        params: {
          fromTitle: fromMatch?.[1]?.trim(),
          toTitle: toMatch?.[1]?.trim() || "Renamed Column",
        },
        originalText: input,
      },
    ];
  }

  // Add card/task — flexible matching for natural language variations
  if (
    lower.match(
      /(?:add|create|make|put|new)\b.*(?:task|card|item|todo|note|reminder|ticket|checklist)/i,
    ) ||
    (lower.match(/^(?:add|create|make)\b/) && input.match(/["']([^"']+)["']/))
  ) {
    const titleMatch = input.match(/["']([^"']+)["']/);
    const toColumnMatch = input.match(
      /(?:to|in|into)\s+(?:the\s+)?["']?([^"']+?)(?:["']|\s+column|$)/i,
    );
    // Detect checklist items: "with items: X, Y, Z" or "with items X, Y, Z"
    const checklistMatch = input.match(
      /(?:with\s+(?:items|tasks|steps)[:\s]+)(.+)/i,
    );
    const checklistItems = checklistMatch
      ? checklistMatch[1]
          .split(/,|;|\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    return [
      {
        type: "add_card",
        params: {
          title: titleMatch?.[1]?.trim() || "New Task",
          columnTitle: toColumnMatch?.[1]?.trim(),
          checklistItems,
        },
        originalText: input,
      },
    ];
  }

  // Move card — also match pronouns ("it", "that", "this") and bare "move to X"
  if (
    lower.match(
      /(?:move|put|send|transfer)\s+(?:the\s+|a\s+)?(?:(?:\w+\s+)*?(?:task|card|item)|it|that|this)\b/,
    ) ||
    lower.match(/(?:move|put|send|transfer)\s+(?:to|into)\s+/)
  ) {
    const titleMatch = input.match(/["']([^"']+)["']/);
    const toColumnMatch = input.match(
      /(?:to|into)\s+(?:the\s+)?["']?([^"']+?)(?:["']|\s+column|$)/i,
    );
    return [
      {
        type: "move_card",
        params: {
          cardTitle: titleMatch?.[1]?.trim(),
          toColumnTitle: toColumnMatch?.[1]?.trim(),
        },
        originalText: input,
      },
    ];
  }

  // Remove card — flexible matching + pronouns
  if (
    lower.match(
      /(?:remove|delete|trash|discard)\s+(?:the\s+|a\s+)?(?:(?:\w+\s+)*?(?:task|card|item|todo|note|ticket)|it|that|this)\b/,
    ) ||
    lower.match(/(?:remove|delete) ["']/)
  ) {
    const titleMatch = input.match(/["']([^"']+)["']/);
    return [
      {
        type: "remove_card",
        params: { title: titleMatch?.[1]?.trim() },
        originalText: input,
      },
    ];
  }

  // Set target date — also accept "for it/that/this"
  if (lower.match(/set (the )?due date|set (the )?target|due|deadline/)) {
    const titleMatch = input.match(/(?:for\s*["'])([^"']+)(?:["'])/);
    const pronounMatch =
      !titleMatch && lower.match(/(?:for|on)\s+(?:it|that|this)\b/);
    const dateMatch = input.match(
      /(?:to|on|for)\s+(?:the\s+)?(\w+day|tomorrow|next \w+|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})/i,
    );
    return [
      {
        type: "set_target_date",
        params: {
          cardTitle: pronounMatch ? undefined : titleMatch?.[1]?.trim(),
          date: dateMatch?.[1] || "next week",
        },
        originalText: input,
      },
    ];
  }

  // Extract card JSON
  if (
    lower.match(
      /(?:export|extract|show|get|dump)\b.*(?:card|task|item)\b.*(?:json|data)/i,
    ) ||
    lower.match(/(?:json|data)\b.*(?:for|of|from)\b.*(?:card|task|item)/i)
  ) {
    const titleMatch = input.match(/["']([^"']+)["']/);
    return [
      {
        type: "extract_card_json",
        params: { cardTitle: titleMatch?.[1]?.trim() },
        originalText: input,
      },
    ];
  }

  // Extract column JSON
  if (
    lower.match(
      /(?:export|extract|show|get|dump)\b.*(?:column|list)\b.*(?:json|data)/i,
    ) ||
    lower.match(/(?:json|data)\b.*(?:for|of|from)\b.*(?:column|list)/i) ||
    lower.match(
      /(?:export|extract|show|get|dump)\b.*(?:the\s+)?(\w+)\b.*(?:as\s+)?json/i,
    )
  ) {
    const titleMatch = input.match(/["']([^"']+)["']/);
    const namedMatch = !titleMatch
      ? input.match(
          /(?:export|extract|show|get|dump)\s+(?:the\s+)?(.+?)\s+(?:column\s+)?(?:as\s+)?json/i,
        )
      : null;
    return [
      {
        type: "extract_column_json",
        params: {
          columnTitle: titleMatch?.[1]?.trim() || namedMatch?.[1]?.trim(),
        },
        originalText: input,
      },
    ];
  }

  // Switch view
  if (lower.match(/show (the )?timeline|switch to timeline|timeline view/)) {
    return [
      {
        type: "switch_view",
        params: { view: "timeline" },
        originalText: input,
      },
    ];
  }
  if (lower.match(/show (the )?board|switch to board|board view|kanban/)) {
    return [
      {
        type: "switch_view",
        params: { view: "board" },
        originalText: input,
      },
    ];
  }

  // Last-resort heuristic: if input has a quoted string, treat as add_card
  const lastResortTitle = input.match(/["']([^"']+)["']/);
  if (lastResortTitle) {
    const toColumnMatch = input.match(
      /(?:to|in|into)\s+(?:the\s+)?["']?([^"']+?)(?:["']|\s+column|$)/i,
    );
    return [
      {
        type: "add_card",
        params: {
          title: lastResortTitle[1].trim(),
          columnTitle: toColumnMatch?.[1]?.trim(),
        },
        originalText: input,
      },
    ];
  }

  return [
    {
      type: "unknown",
      params: {},
      originalText: input,
    },
  ];
}

// Generate board-aware quick action suggestions
function getQuickActions(
  board:
    | ReturnType<typeof useBoardStore.getState>["boards"][number]
    | undefined
    | null,
): string[] {
  if (!board || board.columns.length === 0) {
    return [
      "Add a column called 'To Do'",
      "Add a column called 'In Progress'",
      "Add a column called 'Done'",
    ];
  }

  const columns = board.columns;
  const allCards = columns.flatMap((c) => c.cards.filter((x) => !x.isArchived));
  const actions: string[] = [];

  // Suggest adding a card to the first column (typically the backlog/todo)
  const firstCol = columns[0];
  if (firstCol) {
    actions.push(`Add a task to ${firstCol.title}`);
  }

  // If there are cards, suggest moving one forward
  for (const col of columns) {
    const activeCards = col.cards.filter((c) => !c.isArchived);
    const nextCol = columns[columns.indexOf(col) + 1];
    if (activeCards.length > 0 && nextCol) {
      const card = activeCards[0];
      actions.push(`Move '${card.title}' to ${nextCol.title}`);
      break;
    }
  }

  // Suggest setting a due date on a card without one
  const noDueDate = allCards.find((c) => !c.targetDate);
  if (noDueDate) {
    actions.push(`Set due Friday for '${noDueDate.title}'`);
  }

  // If a "done" style column has cards, suggest exporting or clearing
  const doneCol = columns.find((c) => /done|complete|finish/i.test(c.title));
  if (doneCol && doneCol.cards.filter((c) => !c.isArchived).length > 0) {
    actions.push(`Export ${doneCol.title} as JSON`);
  }

  // Suggest card count if board has cards
  if (allCards.length > 0) {
    actions.push(`How many cards total?`);
  }

  // Always offer timeline as an option
  actions.push("Show the timeline");

  return actions.slice(0, 5);
}

function UpgradeButton({
  session,
}: {
  session: { access_token?: string } | null;
}) {
  const [isLoading, setIsLoading] = useState(false);

  const handleUpgrade = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
      });
      const data = (await res.json()) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void handleUpgrade();
      }}
      disabled={isLoading}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg gradient-cyan text-[#0B0F0F] font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
    >
      <Crown className="w-4 h-4" />
      {isLoading ? "Loading..." : "Upgrade to Pro for Unlimited AI"}
    </button>
  );
}

export function AIAssistant({ isOpen, onClose, onUpgrade }: AIAssistantProps) {
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
  const { session } = useAuthContext();
  const { limit, remaining, isLimitReached, isPaid, resetsAt, updateUsage } =
    useAIUsage();

  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCardTitle = useRef<string | null>(null);

  const activeBoard = getActiveBoard();
  const quickActions = getQuickActions(activeBoard);

  // Set welcome message on first open or when board changes
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          content:
            "Hi! I'm your ZeroBoard AI assistant. I can help you manage your boards, columns, and cards using natural language. Try saying:\n\n• " +
            quickActions.join("\n• "),
          timestamp: new Date().toISOString(),
        },
      ]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      return typeof value === "string" ? value : undefined;
    };

    switch (command.type) {
      case "create_board": {
        const name = getString("name") || "New Board";
        createBoard(name, "Created via AI");
        return `Created board "${name}"`;
      }

      case "add_column": {
        if (!activeBoardId)
          return "No active board. Please select or create a board first.";
        const title = getString("title") || "New Column";
        addColumn(activeBoardId, title);
        return `Added column "${title}"`;
      }

      case "remove_column": {
        if (!activeBoardId) return "No active board.";
        const title = getString("title");
        const column = activeBoard?.columns.find((c) =>
          title ? c.title.toLowerCase() === title.toLowerCase() : false,
        );
        if (!column)
          return title ? `Column "${title}" not found.` : "Column not found.";
        removeColumn(activeBoardId, column.id);
        return title
          ? `Removed column "${title}"`
          : `Removed column "${column.title}"`;
      }

      case "rename_column": {
        if (!activeBoardId) return "No active board.";
        const fromTitle = getString("fromTitle");
        const toTitle = getString("toTitle") || "Renamed Column";
        const column = activeBoard?.columns.find((c) =>
          fromTitle ? c.title.toLowerCase() === fromTitle.toLowerCase() : false,
        );
        if (!column)
          return fromTitle
            ? `Column "${fromTitle}" not found.`
            : "Column not found.";
        renameColumn(activeBoardId, column.id, toTitle);
        return `Renamed column to "${toTitle}"`;
      }

      case "add_card": {
        if (!activeBoardId) return "No active board.";
        let columnId = activeBoard?.columns[0]?.id;

        const title = getString("title") || "New Task";
        const columnTitle = getString("columnTitle");

        if (columnTitle) {
          const column = activeBoard?.columns.find((c) =>
            c.title.toLowerCase().includes(columnTitle.toLowerCase()),
          );
          if (column) columnId = column.id;
        }

        if (!columnId) return "No column found to add the card to.";

        const rawItems = command.params.checklistItems;
        const checklistItems = Array.isArray(rawItems)
          ? rawItems.filter((i): i is string => typeof i === "string")
          : [];
        if (checklistItems.length > 0) {
          const checklist = checklistItems.map((text) => ({
            id: uuidv4(),
            text,
            completed: false,
          }));
          addCard(activeBoardId, columnId, title, {
            type: "checklist",
            checklist,
          });
          lastCardTitle.current = title;
          return `Added checklist "${title}" with ${checklist.length} items`;
        }

        addCard(activeBoardId, columnId, title, { type: "text", text: "" });
        lastCardTitle.current = title;
        return `Added card "${title}"`;
      }

      case "remove_card": {
        if (!activeBoardId) return "No active board.";
        let removed = false;
        const title = getString("title") || lastCardTitle.current || undefined;
        activeBoard?.columns.forEach((column) => {
          const card = column.cards.find((c) =>
            title ? c.title.toLowerCase().includes(title.toLowerCase()) : false,
          );
          if (card) {
            removeCard(activeBoardId, column.id, card.id);
            lastCardTitle.current = card.title;
            removed = true;
          }
        });
        if (!title)
          return "No card specified and no previous card to reference.";
        return removed
          ? `Removed card "${title}"`
          : `Card "${title}" not found.`;
      }

      case "move_card": {
        if (!activeBoardId) return "No active board.";

        let sourceColumnId: string | undefined;
        let cardId: string | undefined;
        const cardTitle =
          getString("cardTitle") || lastCardTitle.current || undefined;
        const toColumnTitle = getString("toColumnTitle");

        activeBoard?.columns.forEach((column) => {
          const card = column.cards.find((c) =>
            cardTitle
              ? c.title.toLowerCase().includes(cardTitle.toLowerCase())
              : false,
          );
          if (card) {
            sourceColumnId = column.id;
            cardId = card.id;
          }
        });

        if (!cardId) {
          if (!cardTitle)
            return "No card specified and no previous card to reference.";
          return `Card "${cardTitle}" not found.`;
        }

        const targetColumn = activeBoard?.columns.find((c) =>
          toColumnTitle
            ? c.title.toLowerCase().includes(toColumnTitle.toLowerCase())
            : false,
        );
        if (!targetColumn)
          return toColumnTitle
            ? `Column "${toColumnTitle}" not found.`
            : "Column not found.";

        moveCard(activeBoardId, sourceColumnId!, targetColumn.id, cardId);
        lastCardTitle.current = cardTitle || null;
        return `Moved "${cardTitle || "card"}" to ${targetColumn.title}`;
      }

      case "set_target_date": {
        if (!activeBoardId) return "No active board.";

        // Parse date
        let targetDate: string;
        const dateStr = getString("date")?.toLowerCase();
        if (dateStr === "tomorrow") {
          targetDate = new Date(Date.now() + 86400000)
            .toISOString()
            .split("T")[0];
        } else if (dateStr === "friday") {
          const today = new Date();
          const daysUntilFriday = (5 - today.getDay() + 7) % 7 || 7;
          const friday = new Date(today.getTime() + daysUntilFriday * 86400000);
          targetDate = friday.toISOString().split("T")[0];
        } else if (dateStr?.match(/^\d{4}-\d{2}-\d{2}$/)) {
          targetDate = dateStr;
        } else {
          targetDate = new Date(Date.now() + 7 * 86400000)
            .toISOString()
            .split("T")[0];
        }

        let updated = false;
        const cardTitle =
          getString("cardTitle") || lastCardTitle.current || undefined;
        activeBoard?.columns.forEach((column) => {
          const card = column.cards.find((c) =>
            cardTitle
              ? c.title.toLowerCase().includes(cardTitle.toLowerCase())
              : false,
          );
          if (card) {
            editCard(activeBoardId, column.id, card.id, { targetDate });
            lastCardTitle.current = card.title;
            updated = true;
          }
        });

        if (!cardTitle)
          return "No card specified and no previous card to reference.";
        return updated
          ? `Set due date for "${cardTitle}" to ${targetDate}`
          : `Card "${cardTitle}" not found.`;
      }

      case "extract_card_json": {
        if (!activeBoardId) return "No active board.";
        const cardTitle =
          getString("cardTitle") || lastCardTitle.current || undefined;
        if (!cardTitle)
          return "No card specified and no previous card to reference.";
        for (const col of activeBoard?.columns ?? []) {
          const card = col.cards.find((c) =>
            c.title.toLowerCase().includes(cardTitle.toLowerCase()),
          );
          if (card) {
            lastCardTitle.current = card.title;
            downloadJson(
              card,
              `card-${card.title.toLowerCase().replace(/\s+/g, "-")}`,
            );
            return `Downloaded JSON for card "${card.title}"`;
          }
        }
        return `Card "${cardTitle}" not found.`;
      }

      case "extract_column_json": {
        if (!activeBoardId) return "No active board.";
        const columnTitle = getString("columnTitle");
        if (!columnTitle) return "Please specify a column name.";
        const column = activeBoard?.columns.find((c) =>
          c.title.toLowerCase().includes(columnTitle.toLowerCase()),
        );
        if (!column) return `Column "${columnTitle}" not found.`;
        downloadJson(
          column,
          `column-${column.title.toLowerCase().replace(/\s+/g, "-")}`,
        );
        return `Downloaded JSON for column "${column.title}" (${column.cards.length} cards)`;
      }

      case "clear_column": {
        if (!activeBoardId) return "No active board.";
        const columnTitle = getString("columnTitle");
        if (!columnTitle) return "Please specify a column name.";
        const column = activeBoard?.columns.find((c) =>
          c.title.toLowerCase().includes(columnTitle.toLowerCase()),
        );
        if (!column) return `Column "${columnTitle}" not found.`;
        const cardCount = column.cards.length;
        if (cardCount === 0)
          return `Column "${column.title}" is already empty.`;
        column.cards.forEach((card) => {
          removeCard(activeBoardId, column.id, card.id);
        });
        return `Cleared ${cardCount} card${cardCount !== 1 ? "s" : ""} from "${column.title}"`;
      }

      case "count_cards": {
        if (!activeBoardId) return "No active board.";
        const columnTitle = getString("columnTitle");
        if (columnTitle) {
          const column = activeBoard?.columns.find((c) =>
            c.title.toLowerCase().includes(columnTitle.toLowerCase()),
          );
          if (!column) return `Column "${columnTitle}" not found.`;
          const active = column.cards.filter((c) => !c.isArchived).length;
          return `"${column.title}" has ${active} card${active !== 1 ? "s" : ""}`;
        }
        const total =
          activeBoard?.columns.reduce(
            (sum, c) => sum + c.cards.filter((x) => !x.isArchived).length,
            0,
          ) ?? 0;
        const breakdown = activeBoard?.columns
          .map(
            (c) => `${c.title}: ${c.cards.filter((x) => !x.isArchived).length}`,
          )
          .join(", ");
        return `${total} total card${total !== 1 ? "s" : ""} (${breakdown})`;
      }

      case "rename_card": {
        if (!activeBoardId) return "No active board.";
        const cardTitle =
          getString("cardTitle") || lastCardTitle.current || undefined;
        const newTitle = getString("newTitle");
        if (!cardTitle)
          return "No card specified and no previous card to reference.";
        if (!newTitle) return "Please specify the new title.";
        for (const column of activeBoard?.columns ?? []) {
          const card = column.cards.find((c) =>
            c.title.toLowerCase().includes(cardTitle.toLowerCase()),
          );
          if (card) {
            editCard(activeBoardId, column.id, card.id, { title: newTitle });
            lastCardTitle.current = newTitle;
            return `Renamed "${card.title}" to "${newTitle}"`;
          }
        }
        return `Card "${cardTitle}" not found.`;
      }

      case "switch_view": {
        const view = getString("view");
        if (view !== "board" && view !== "timeline") return "Unknown view.";
        setViewMode(view);
        return `Switched to ${view} view`;
      }

      default:
        return "I'm not sure how to help with that. Try commands like:\n• Add 5 random tasks to TODO\n• Add tasks: design, build, test to Done\n• Clear the TODO column\n• How many cards in Done?\n• Rename card 'old' to 'new'\n• Export the Done column as JSON\n• Show the timeline";
    }
  };

  const handleSend = async (overrideText?: string) => {
    const text = overrideText || input.trim();
    if (!text || isProcessing) return;

    const userMessage: AIMessage = {
      id: uuidv4(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsProcessing(true);

    const boardContext = (() => {
      if (!activeBoard) return "";
      const snapshot = {
        boardName: activeBoard.name,
        columns: activeBoard.columns.map((c) => ({
          title: c.title,
          cards: c.cards.filter((x) => !x.isArchived).map((x) => x.title),
        })),
      };
      return JSON.stringify(snapshot);
    })();

    // Extract last executed command for pronoun resolution
    const lastMsg = [...messages]
      .reverse()
      .find(
        (m) =>
          m.role === "assistant" && m.command && m.command.type !== "unknown",
      );
    const lastCommand = lastMsg?.command
      ? { type: lastMsg.command.type, params: lastMsg.command.params }
      : undefined;

    const aiResponse = await parseCommandWithAI(
      userMessage.content,
      boardContext,
      lastCommand,
      session?.access_token,
    );

    // Update usage from response
    if (aiResponse.usage) {
      updateUsage(aiResponse.usage);
    }

    // Handle daily limit reached
    if (aiResponse.limitReached) {
      const resetTime = aiResponse.usage?.resetsAt || resetsAt;
      const resetLabel = resetTime
        ? new Date(resetTime).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })
        : "tomorrow";
      const limitMessage: AIMessage = {
        id: uuidv4(),
        role: "assistant",
        content: `You've used all 5 free AI queries for today. Your limit resets at ${resetLabel}. Upgrade to Pro for unlimited AI access!`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, limitMessage]);
      if (onUpgrade) onUpgrade();
      setIsProcessing(false);
      return;
    }

    const commands =
      aiResponse.commands ?? parseCommandLocal(userMessage.content);

    const results: string[] = [];
    for (let i = 0; i < commands.length; i++) {
      const result = executeCommand(commands[i]);
      results.push(result);
      if (i < commands.length - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    const content =
      commands.length > 1
        ? results.map((r, i) => `${i + 1}. ${r}`).join("\n")
        : results[0];

    const assistantMessage: AIMessage = {
      id: uuidv4(),
      role: "assistant",
      content,
      timestamp: new Date().toISOString(),
      command: commands[0],
      commands: commands.length > 1 ? commands : undefined,
    };

    setMessages((prev) => [...prev, assistantMessage]);

    // Show warning if approaching limit
    if (aiResponse.usage?.warning && !isPaid) {
      const queriesRemaining = (limit ?? 5) - aiResponse.usage.used;
      const warningMessage: AIMessage = {
        id: uuidv4(),
        role: "assistant",
        content:
          queriesRemaining === 1
            ? "Warning: Last AI query for today! Upgrade to Pro for unlimited AI queries."
            : `Warning: You have ${queriesRemaining} AI quer${queriesRemaining === 1 ? "y" : "ies"} remaining today.`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, warningMessage]);
    }

    setIsProcessing(false);
  };

  const handleQuickAction = (action: string) => {
    setInput(action);
    handleSend(action);
  };

  if (!isOpen) return null;

  return (
    <div className="h-full w-[360px] flex-shrink-0 bg-[#111515] border-r border-white/10 flex flex-col overflow-hidden">
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
        {!isPaid && limit != null && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/5 border border-white/5">
            <Zap
              className={`w-3.5 h-3.5 ${isLimitReached ? "text-red-400" : remaining != null && remaining <= 2 ? "text-amber-400" : "text-[#78fcd6]"}`}
            />
            <span
              className={`text-xs font-medium ${isLimitReached ? "text-red-400" : remaining != null && remaining <= 2 ? "text-amber-400" : "text-[#A8B2B2]"}`}
            >
              {remaining ?? 0}/{limit}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              setMessages([
                {
                  id: "welcome",
                  role: "assistant",
                  content:
                    "Hi! I'm your ZeroBoard AI assistant. I can help you manage your boards, columns, and cards using natural language. Try saying:\n\n• " +
                    quickActions.join("\n• "),
                  timestamp: new Date().toISOString(),
                },
              ])
            }
            className="p-3 hover:bg-white/5 rounded-lg text-[#A8B2B2] hover:text-[#F2F7F7] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            title="Clear chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-3 hover:bg-white/5 rounded-lg text-[#A8B2B2] hover:text-[#F2F7F7] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 min-h-0 overflow-y-auto p-4 scrollbar-thin"
        ref={scrollRef}
      >
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  message.role === "user" ? "bg-white/10" : "gradient-cyan"
                }`}
              >
                {message.role === "user" ? (
                  <User className="w-4 h-4 text-[#F2F7F7]" />
                ) : (
                  <Bot className="w-4 h-4 text-[#0B0F0F]" />
                )}
              </div>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm overflow-hidden ${
                  message.role === "user"
                    ? "bg-[#78fcd6]/20 text-[#F2F7F7] rounded-br-md"
                    : "bg-white/5 text-[#F2F7F7] rounded-bl-md"
                }`}
              >
                {message.command?.type === "unknown" &&
                message.role === "assistant" ? (
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <span>{message.content}</span>
                  </div>
                ) : message.command && message.role === "assistant" ? (
                  <div className="flex items-start gap-2 min-w-0">
                    <Check className="w-4 h-4 text-[#78fcd6] flex-shrink-0 mt-0.5" />
                    <span className="break-all whitespace-pre-wrap min-w-0">
                      {message.content}
                    </span>
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
                  <span
                    className="w-2 h-2 bg-[#78fcd6] rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-2 h-2 bg-[#78fcd6] rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-2 h-2 bg-[#78fcd6] rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="px-4 py-2 border-t border-white/5 bg-[#0B0F0F]/50">
        <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-2">
          {quickActions.map((action) => (
            <button
              type="button"
              key={action}
              onClick={() => handleQuickAction(action)}
              className="flex-shrink-0 text-xs px-3 py-1.5 border border-[#78fcd6]/30 rounded-full hover:bg-[#78fcd6]/10 hover:border-[#78fcd6]/50 transition-all duration-300 bg-gradient-to-r from-black/20 to-transparent backdrop-blur-sm text-[#78fcd6] font-medium"
            >
              {action.length > 25 ? action.slice(0, 25) + "..." : action}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/10 bg-[#0B0F0F]">
        {isLimitReached && !isPaid ? (
          <div className="text-center py-2">
            <p className="text-sm text-[#A8B2B2] mb-2">
              Daily limit reached — resets at midnight PT
            </p>
            <UpgradeButton session={session} />
          </div>
        ) : (
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="What should we do next?"
              className="flex-1 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50 h-10"
              disabled={isProcessing}
            />
            <Button
              onClick={() => handleSend()}
              disabled={!input.trim() || isProcessing}
              className="h-10 w-10 p-0 gradient-cyan text-[#0B0F0F] hover:opacity-90 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
