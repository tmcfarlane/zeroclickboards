import { useState } from 'react';
import { getAllBoardTemplates, deleteUserBoardTemplate, type BoardTemplate } from '@/lib/templates';
import { Layout, Trash2 } from 'lucide-react';

interface TemplatePickerProps {
  onSelect: (template: BoardTemplate | null) => void;
  selected: BoardTemplate | null;
}

export function TemplatePicker({ onSelect, selected }: TemplatePickerProps) {
  const [templates, setTemplates] = useState(() => getAllBoardTemplates());

  return (
    <div className="space-y-3">
      <span className="text-xs font-medium text-[#A8B2B2] uppercase tracking-wider">Start from template</span>
      <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto scrollbar-thin pr-1">
        {/* Blank option */}
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`text-left p-3 rounded-lg border transition-colors ${
            !selected
              ? 'border-[#78fcd6]/40 bg-[#78fcd6]/10'
              : 'border-white/10 bg-white/5 hover:bg-white/10'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Layout className="w-4 h-4 text-[#A8B2B2]" />
            <span className="text-sm font-medium text-[#F2F7F7]">Blank</span>
          </div>
          <p className="text-[10px] text-[#A8B2B2]">Default columns</p>
        </button>

        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelect(template)}
            className={`text-left p-3 rounded-lg border transition-colors relative group ${
              selected?.id === template.id
                ? 'border-[#78fcd6]/40 bg-[#78fcd6]/10'
                : 'border-white/10 bg-white/5 hover:bg-white/10'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Layout className="w-4 h-4 text-[#78fcd6]" />
              <span className="text-sm font-medium text-[#F2F7F7] truncate">{template.name}</span>
            </div>
            <p className="text-[10px] text-[#A8B2B2] line-clamp-1">{template.description}</p>
            <p className="text-[10px] text-[#A8B2B2]/60 mt-0.5">{template.columns.length} columns</p>
            {template.category === 'user' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteUserBoardTemplate(template.id);
                  setTemplates(getAllBoardTemplates());
                  onSelect(null);
                }}
                className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-red-400 transition-opacity"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
