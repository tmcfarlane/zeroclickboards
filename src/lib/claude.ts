import type { Card, Column } from '@/types';

export function formatCardAsInstructions(card: Card): string {
  let text = `## ${card.title}\n`;
  if (card.description) text += `\n${card.description}\n`;

  if (card.content.type === 'text' && card.content.text) {
    text += `\n${card.content.text}\n`;
  } else if (card.content.type === 'checklist' && card.content.checklist) {
    text += '\nChecklist:\n';
    for (const item of card.content.checklist) {
      text += `- [${item.completed ? 'x' : ' '}] ${item.text}\n`;
    }
  }

  if (card.targetDate) text += `\nDue: ${card.targetDate}\n`;
  if (card.labels?.length) text += `Labels: ${card.labels.join(', ')}\n`;

  return text;
}

export function formatColumnAsInstructions(column: Column): string {
  const cards = column.cards.filter(c => !c.isArchived);
  let text = `# Column: ${column.title}\n\n`;
  text += `${cards.length} cards:\n\n`;
  for (const card of cards) {
    text += formatCardAsInstructions(card) + '\n---\n\n';
  }
  return text;
}

export async function sendToClaude(instructions: string): Promise<{ response?: string; error?: string }> {
  try {
    const res = await fetch('/api/local/claude', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instructions }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to reach Claude CLI' };
    return { response: data.response };
  } catch {
    return { error: 'Could not connect to local Claude agent. Make sure you are running the dev server and have Claude CLI installed.' };
  }
}
