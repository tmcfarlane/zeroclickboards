import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Attachment, Card } from '@/types';
import { CardEditor } from '../CardEditor';

vi.mock('../CardActivityFeed', () => ({ CardActivityFeed: () => null }));

const first: Attachment = { id: 'image-a', name: 'First image', url: 'https://example.com/a.png', addedAt: '2026-09-06T00:00:00Z', isCover: true };
const second: Attachment = { id: 'image-b', name: 'Second image', url: 'https://example.com/b.png', addedAt: '2026-09-06T00:00:00Z', isCover: false };

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1', title: 'Card with separate text', description: 'A short summary',
    content: { type: 'text', text: 'Longer body\n  Preserve this indentation.\n' },
    createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z',
    ...overrides,
  };
}

function open(initialData: Card) {
  const save = vi.fn();
  render(<CardEditor isOpen mode="edit" cardId={initialData.id} initialData={initialData} onClose={() => {}} onSave={save} />);
  return save;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('CardEditor text fields', () => {
  it('shows distinct description and body values and preserves both on an unrelated edit', async () => {
    const user = userEvent.setup();
    const initial = card();
    const save = open(initial);
    expect(screen.getByLabelText('Description')).toHaveValue(initial.description);
    expect(screen.getByLabelText('Body text')).toHaveValue(initial.content.text);
    await user.type(screen.getByPlaceholderText('Card title...'), ' renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [submitted, baseline] = save.mock.calls[0];
    expect(submitted.description).toBe(initial.description);
    expect(submitted.content).toEqual(initial.content);
    expect(baseline.description).toBe(initial.description);
    expect(baseline.content).toEqual(initial.content);
  });

  it.each(['Description', 'Body text'] as const)('can clear %s without clearing the other field', async (field) => {
    const user = userEvent.setup();
    const initial = card();
    const save = open(initial);
    await user.clear(screen.getByLabelText(field));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [submitted] = save.mock.calls[0];
    expect(submitted.description).toBe(field === 'Description' ? undefined : initial.description);
    expect(submitted.content.text).toBe(field === 'Body text' ? '' : initial.content.text);
  });

  it('keeps a checklist separate when its description is edited', async () => {
    const user = userEvent.setup();
    const content = { type: 'checklist' as const, checklist: [{ id: 'item-1', text: 'Task', completed: false }] };
    const save = open(card({ content }));
    expect(screen.queryByLabelText('Body text')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), 'Updated checklist context');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0]).toMatchObject({ description: 'Updated checklist context', content });
  });
});

describe('CardEditor due dates', () => {
  it.each([
    ['2026-02-28T23:30:00-08:00', '2026-02-28'],
    ['2024-02-29T00:00:00.123Z', '2024-02-29'],
    ['0099-03-04', '0099-03-04'],
  ])('displays legacy date %s as %s without introducing a date edit', async (targetDate, displayedDate) => {
    const user = userEvent.setup();
    const initial = card({ targetDate });
    const save = open(initial);
    expect(screen.getByLabelText('Due date')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Due date')).toHaveValue(displayedDate);
    await user.type(screen.getByPlaceholderText('Card title...'), ' renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [submitted, baseline] = save.mock.calls[0];
    expect(submitted.targetDate).toBe(displayedDate);
    expect(baseline.targetDate).toBe(displayedDate);
    expect(submitted.description).toBe(initial.description);
    expect(submitted.content).toEqual(initial.content);
  });

  it.each(['2026-02-30', 'not-a-date', '2026-02-28T99:30:00Z'])('shows invalid saved date %s for repair and preserves it during an unrelated edit', async (targetDate) => {
    const user = userEvent.setup();
    const save = open(card({ targetDate }));
    expect(screen.getByLabelText('Due date')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent(targetDate);
    expect(screen.getByRole('status')).toHaveTextContent('It will stay unchanged until you do.');
    await user.type(screen.getByPlaceholderText('Card title...'), ' renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [submitted, baseline] = save.mock.calls[0];
    expect(submitted.targetDate).toBe(targetDate);
    expect(baseline.targetDate).toBe(targetDate);
  });

  it.each(['change', 'remove'] as const)('can explicitly %s an invalid saved date', async (action) => {
    const user = userEvent.setup();
    const initial = card({ targetDate: '2026-02-30' });
    const save = open(initial);
    if (action === 'change') fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-03-01' } });
    else await user.click(screen.getByRole('button', { name: 'Remove due date' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0].targetDate).toBe(action === 'change' ? '2026-03-01' : undefined);
    expect(save.mock.calls[0][0].content).toEqual(initial.content);
    expect(save.mock.calls[0][0].description).toBe(initial.description);
  });

  it('retains a draft when the native picker reports an incomplete date, then saves a correction', async () => {
    const user = userEvent.setup();
    const save = open(card({ targetDate: '2026-03-01' }));
    await user.type(screen.getByPlaceholderText('Card title...'), ' draft');
    const input = screen.getByLabelText('Due date');
    let badInput = true;
    Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput }) });
    // Native date editors can expose badInput before a React change event.
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a complete, valid date or remove the due date.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByPlaceholderText('Card title...')).toHaveValue('Card with separate text draft');
    badInput = false;
    fireEvent.change(input, { target: { value: '2026-03-02' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0]).toMatchObject({ title: 'Card with separate text draft', targetDate: '2026-03-02' });
  });

  it('distinguishes an incomplete empty native value from deliberate date removal', async () => {
    const user = userEvent.setup();
    const save = open(card({ targetDate: '2026-03-01' }));
    const input = screen.getByLabelText('Due date');
    Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput: true }) });
    fireEvent.change(input, { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove due date' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0].targetDate).toBeUndefined();
  });

  it('rejects a complete picker value beyond the supported finite date range', async () => {
    const user = userEvent.setup();
    const save = open(card({ targetDate: '2026-03-01' }));
    const input = screen.getByLabelText('Due date');
    fireEvent.change(input, { target: { value: '999999-01-01' } });
    expect(input).toHaveValue('999999-01-01');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a complete, valid date or remove the due date.');
    expect(input).toHaveValue('999999-01-01');
  });

  it('allows clearing a complete native date without a validation error', async () => {
    const user = userEvent.setup();
    const save = open(card({ targetDate: '2026-03-01' }));
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0].targetDate).toBeUndefined();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('CardEditor recurrence', () => {
  it.each(['', '0', '100', '1.5'])('keeps an invalid interval draft open (%s) and saves after correction', async (value) => {
    const user = userEvent.setup();
    const initial = card({ recurrence: { frequency: 'weekly', interval: 1, daysOfWeek: [1, 3] } });
    const save = open(initial);
    await user.type(screen.getByPlaceholderText('Card title...'), ' draft');
    const interval = screen.getByRole('spinbutton', { name: 'Repeat every' });
    fireEvent.change(interval, { target: { value } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 99.');
    expect(interval).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByPlaceholderText('Card title...')).toHaveValue(`${initial.title} draft`);
    await user.clear(interval);
    await user.type(interval, '2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0]).toMatchObject({
      title: `${initial.title} draft`, description: initial.description, content: initial.content,
      recurrence: { frequency: 'weekly', interval: 2, daysOfWeek: [1, 3] },
    });
  });

  it.each(['-1', '0', '32', '1.5'])('rejects an invalid monthly day (%s) without submitting', async (value) => {
    const user = userEvent.setup();
    const save = open(card({ recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 31 } }));
    const day = screen.getByRole('spinbutton', { name: 'Day of month' });
    fireEvent.change(day, { target: { value } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 31, or leave this blank.');
    expect(day).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it.each([[1, 1], [99, 31]])('accepts boundary interval %s and monthly day %s', async (interval, dayOfMonth) => {
    const user = userEvent.setup();
    const save = open(card({ recurrence: { frequency: 'monthly', interval: 2, dayOfMonth: 15 } }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Repeat every' }), { target: { value: String(interval) } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Day of month' }), { target: { value: String(dayOfMonth) } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0].recurrence).toEqual({ frequency: 'monthly', interval, dayOfMonth });
  });

  it('clears the optional monthly day without clearing the schedule or other card fields', async () => {
    const user = userEvent.setup();
    const initial = card({ targetDate: '2026-01-31', recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 31 } });
    const save = open(initial);
    expect(screen.getByLabelText('Due date')).toHaveValue(initial.targetDate);
    await user.clear(screen.getByRole('spinbutton', { name: 'Day of month' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0]).toMatchObject({ description: initial.description, content: initial.content, targetDate: initial.targetDate });
    expect(save.mock.calls[0][0].recurrence).toEqual({ frequency: 'monthly', interval: 1 });
  });

  it('drops inactive schedule fields when switching frequency', async () => {
    const user = userEvent.setup();
    const save = open(card({ recurrence: { frequency: 'weekly', interval: 2, daysOfWeek: [1, 3] } }));
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'monthly' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Day of month' }), '31');
    await user.click(screen.getByRole('button', { name: 'daily' }));
    await user.click(screen.getByRole('button', { name: 'weekly' }));
    expect(screen.getByRole('button', { name: 'weekly' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0].recurrence).toEqual({ frequency: 'weekly', interval: 2 });
  });

  it('sorts and deduplicates weekdays only after a deliberate schedule edit', async () => {
    const user = userEvent.setup();
    const recurrence = { frequency: 'weekly' as const, interval: 1, daysOfWeek: [5, 1, 1] };
    const save = open(card({ recurrence }));
    await user.type(screen.getByPlaceholderText('Card title...'), ' renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0].recurrence).toEqual(recurrence);
    expect(save.mock.calls[0][1].recurrence).toEqual(recurrence);
    await user.click(screen.getByRole('button', { name: 'Wednesday' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[1][0].recurrence).toEqual({ frequency: 'weekly', interval: 1, daysOfWeek: [1, 3, 5] });
    expect(recurrence.daysOfWeek).toEqual([5, 1, 1]);
  });

  it('removes recurrence without changing the due date or text fields', async () => {
    const user = userEvent.setup();
    const initial = card({ targetDate: '2026-01-31', recurrence: { frequency: 'monthly', interval: 1 } });
    const save = open(initial);
    await user.click(screen.getByRole('button', { name: 'Remove recurrence' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0].recurrence).toBeUndefined();
    expect(save.mock.calls[0][0]).toMatchObject({ description: initial.description, content: initial.content, targetDate: initial.targetDate });
  });
});

describe('CardEditor cover selection', () => {
  it('uses the canonical cover URL and selects only the first matching attachment while retaining metadata', async () => {
    const user = userEvent.setup();
    const selected = { ...second, extra: { caption: 'Metadata to retain' } };
    const duplicate = { ...second, id: 'duplicate-b', name: 'Duplicate image', isCover: true };
    const save = open(card({ coverImage: second.url, attachments: [first, selected, duplicate] }));
    expect(screen.getByAltText('Card cover')).toHaveAttribute('src', second.url);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [submitted, baseline] = save.mock.calls[0];
    expect(submitted.coverImage).toBe(second.url);
    expect(submitted.attachments.map((attachment: Attachment) => attachment.isCover)).toEqual([false, true, false]);
    expect(submitted.attachments[1].extra).toEqual({ caption: 'Metadata to retain' });
    expect(submitted.attachments).toEqual(baseline.attachments);
  });

  it('does not revive a cleared cover when an attachment is renamed, including a legacy body image', async () => {
    const user = userEvent.setup();
    const imageUrl = 'https://example.com/legacy.png';
    const save = open(card({ coverImage: undefined, attachments: [first, second], content: { type: 'image', imageUrl } }));
    expect(screen.queryByAltText('Card cover')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for First image' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const name = await screen.findByRole('textbox', { name: 'Attachment name' });
    await user.clear(name);
    await user.type(name, 'Renamed attachment');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [submitted] = save.mock.calls[0];
    expect(submitted.coverImage).toBeUndefined();
    expect(submitted.attachments.every((attachment: Attachment) => !attachment.isCover)).toBe(true);
    expect(submitted.attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, name: 'Renamed attachment' }),
      expect.objectContaining({ url: imageUrl, isCover: false }),
    ]));
  });

  it('does not assign a cover when an unrelated attachment is removed after clearing the cover', async () => {
    const user = userEvent.setup();
    const save = open(card({ coverImage: first.url, attachments: [first, second] }));
    await user.click(screen.getByRole('button', { name: 'Remove card cover' }));
    await user.click(screen.getByRole('button', { name: 'Actions for Second image' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(screen.queryByAltText('Card cover')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [submitted] = save.mock.calls[0];
    expect(submitted.coverImage).toBeUndefined();
    expect(submitted.attachments).toEqual([{ ...first, isCover: false }]);
  });

  it('does not assign a replacement cover when the selected attachment is removed', async () => {
    const user = userEvent.setup();
    const save = open(card({ coverImage: first.url, attachments: [first, second] }));
    await user.click(screen.getByRole('button', { name: 'Actions for First image' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [submitted] = save.mock.calls[0];
    expect(submitted.coverImage).toBeUndefined();
    expect(submitted.attachments).toEqual([second]);
  });

  it('selects only one cover when two initial image reads finish asynchronously', async () => {
    const readers: PendingReader[] = [];
    class PendingReader {
      result: string | null = null;
      onloadend?: () => void;
      constructor() { readers.push(this); }
      readAsDataURL() {}
      finish(url: string) { this.result = url; this.onloadend?.(); }
    }
    vi.stubGlobal('FileReader', PendingReader);
    const save = open(card());
    const upload = screen.getByLabelText('Add image attachment');
    fireEvent.change(upload, { target: { files: [new File(['first'], 'first.png', { type: 'image/png' })] } });
    fireEvent.change(upload, { target: { files: [new File(['second'], 'second.png', { type: 'image/png' })] } });
    act(() => { readers[0].finish(first.url); readers[1].finish(second.url); });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const [submitted] = save.mock.calls[0];
    expect(submitted.attachments.map((attachment: Attachment) => attachment.isCover)).toEqual([true, false]);
    expect(submitted.coverImage).toBe(first.url);
  });
});
