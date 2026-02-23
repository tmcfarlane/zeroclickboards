import { useState, useEffect } from 'react';
import type { CardContent, CardLabel, ChecklistItem } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, X, Image as ImageIcon, ListTodo, FileText, Calendar } from 'lucide-react';
import { LabelPicker, LabelStrip } from './LabelPicker';

export interface CardEditorSaveData {
  title: string;
  content: CardContent;
  targetDate?: string;
  labels: CardLabel[];
  coverImage?: string;
}

interface CardEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: CardEditorSaveData) => void;
  mode: 'create' | 'edit';
  initialData?: {
    title: string;
    content: CardContent;
    targetDate?: string;
    labels?: CardLabel[];
    coverImage?: string;
  };
}

export function CardEditor({ isOpen, onClose, onSave, mode, initialData }: CardEditorProps) {
  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState<CardContent['type']>('text');
  const [textContent, setTextContent] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [imageUrl, setImageUrl] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [labels, setLabels] = useState<CardLabel[]>([]);
  const [coverImage, setCoverImage] = useState('');
  const [newChecklistItem, setNewChecklistItem] = useState('');

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setTitle(initialData.title);
        setContentType(initialData.content.type);
        setTextContent(initialData.content.text || '');
        setChecklist(initialData.content.checklist || []);
        setImageUrl(initialData.content.imageUrl || '');
        setTargetDate(initialData.targetDate || '');
        setLabels(initialData.labels || []);
        setCoverImage(initialData.coverImage || '');
      } else {
        setTitle('');
        setContentType('text');
        setTextContent('');
        setChecklist([]);
        setImageUrl('');
        setTargetDate('');
        setLabels([]);
        setCoverImage('');
      }
    }
  }, [isOpen, initialData]);

  const handleSave = () => {
    if (!title.trim()) return;

    let content: CardContent;
    switch (contentType) {
      case 'checklist':
        content = { type: 'checklist', checklist };
        break;
      case 'image':
        content = { type: 'image', imageUrl: imageUrl || undefined };
        break;
      default:
        content = { type: 'text', text: textContent };
    }

    onSave({
      title: title.trim(),
      content,
      targetDate: targetDate || undefined,
      labels,
      coverImage: coverImage || undefined,
    });
  };

  const addChecklistItem = () => {
    if (newChecklistItem.trim()) {
      setChecklist([
        ...checklist,
        {
          id: Math.random().toString(36).substr(2, 9),
          text: newChecklistItem.trim(),
          completed: false,
        },
      ]);
      setNewChecklistItem('');
    }
  };

  const toggleChecklistItem = (id: string) => {
    setChecklist(
      checklist.map((item) =>
        item.id === id ? { ...item, completed: !item.completed } : item
      )
    );
  };

  const removeChecklistItem = (id: string) => {
    setChecklist(checklist.filter((item) => item.id !== id));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setCoverImage(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsDataURL(file);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add Card' : 'Edit Card'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="card-title">Title</Label>
            <Input
              id="card-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter card title..."
              className="bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
            />
          </div>

          {/* Target Date */}
          <div className="space-y-2">
            <Label htmlFor="target-date" className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Target Completion Date (optional)
            </Label>
            <Input
              id="target-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="bg-white/5 border-white/10 text-[#F2F7F7]"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Labels</Label>
              <LabelPicker selectedLabels={labels} onChange={setLabels} />
            </div>
            <LabelStrip labels={labels} />

            <div className="space-y-2">
              <Label htmlFor="cover" className="text-sm">Card cover (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="cover"
                  value={coverImage}
                  onChange={(e) => setCoverImage(e.target.value)}
                  placeholder="Paste an image URL or upload"
                  className="bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
                />
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleCoverUpload}
                  className="w-[150px] bg-white/5 border-white/10 text-[#F2F7F7] file:text-[#A8B2B2]"
                />
              </div>
              {coverImage && (
                <div className="relative">
                  <img
                    src={coverImage}
                    alt="Card cover"
                    className="w-full h-36 object-cover rounded-lg border border-white/10"
                  />
                   <button
                    type="button"
                    onClick={() => setCoverImage('')}
                    className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/70 rounded-lg text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Content Type Tabs */}
          <Tabs value={contentType} onValueChange={(v) => setContentType(v as CardContent['type'])}>
            <TabsList className="grid grid-cols-3 bg-white/5">
              <TabsTrigger value="text" className="data-[state=active]:bg-[#78fcd6]/20 data-[state=active]:text-[#78fcd6]">
                <FileText className="w-4 h-4 mr-1.5" />
                Text
              </TabsTrigger>
              <TabsTrigger value="checklist" className="data-[state=active]:bg-[#78fcd6]/20 data-[state=active]:text-[#78fcd6]">
                <ListTodo className="w-4 h-4 mr-1.5" />
                Checklist
              </TabsTrigger>
              <TabsTrigger value="image" className="data-[state=active]:bg-[#78fcd6]/20 data-[state=active]:text-[#78fcd6]">
                <ImageIcon className="w-4 h-4 mr-1.5" />
                Image
              </TabsTrigger>
            </TabsList>

            {/* Text Content */}
            <TabsContent value="text" className="mt-4">
              <Textarea
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="Add description..."
                className="bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50 min-h-[120px] resize-none"
              />
            </TabsContent>

            {/* Checklist Content */}
            <TabsContent value="checklist" className="mt-4 space-y-3">
              <div className="flex gap-2">
                <Input
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  placeholder="Add checklist item..."
                  className="bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50 flex-1"
                  onKeyDown={(e) => e.key === 'Enter' && addChecklistItem()}
                />
                <Button
                  onClick={addChecklistItem}
                  variant="outline"
                  className="border-white/10 text-[#F2F7F7] hover:bg-white/5"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-2 max-h-[200px] overflow-y-auto scrollbar-thin">
                {checklist.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 p-2 bg-white/5 rounded-lg group"
                  >
                    <Checkbox
                      checked={item.completed}
                      onCheckedChange={() => toggleChecklistItem(item.id)}
                      className="border-white/20 data-[state=checked]:bg-[#78fcd6] data-[state=checked]:border-[#78fcd6]"
                    />
                    <span
                      className={`flex-1 text-sm ${
                        item.completed ? 'text-[#A8B2B2] line-through' : 'text-[#F2F7F7]'
                      }`}
                    >
                      {item.text}
                    </span>
                     <button
                       type="button"
                       onClick={() => removeChecklistItem(item.id)}
                       className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded text-[#A8B2B2] hover:text-red-400 transition-opacity"
                     >
                       <X className="w-4 h-4" />
                     </button>
                  </div>
                ))}
                {checklist.length === 0 && (
                  <p className="text-sm text-[#A8B2B2] text-center py-4">
                    No checklist items yet. Add one above.
                  </p>
                )}
              </div>
            </TabsContent>

            {/* Image Content */}
            <TabsContent value="image" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label>Upload Image</Label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="bg-white/5 border-white/10 text-[#F2F7F7] file:text-[#A8B2B2]"
                />
              </div>

              {imageUrl && (
                <div className="relative">
                  <img
                    src={imageUrl}
                    alt="Card attachment"
                    className="w-full h-48 object-cover rounded-lg border border-white/10"
                  />
                   <button
                     type="button"
                     onClick={() => setImageUrl('')}
                     className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/70 rounded-lg text-white transition-colors"
                   >
                     <X className="w-4 h-4" />
                   </button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            className="border-white/10 text-[#F2F7F7] hover:bg-white/5"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!title.trim()}
            className="gradient-cyan text-[#0B0F0F] hover:opacity-90 disabled:opacity-50"
          >
            {mode === 'create' ? 'Add Card' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
