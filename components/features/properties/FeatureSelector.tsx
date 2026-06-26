import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface FeatureSelectorProps {
  title: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  allowAdd?: boolean;
  onAddNew?: (name: string) => Promise<void>;
  isLoading?: boolean;
}

export function FeatureSelector({
  title,
  options,
  selected,
  onChange,
  allowAdd = false,
  onAddNew,
  isLoading = false,
}: FeatureSelectorProps) {
  const [showInput, setShowInput] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [adding, setAdding] = useState(false);

  const toggleItem = (item: string) => {
    if (selected.includes(item)) {
      onChange(selected.filter(s => s !== item));
    } else {
      onChange([...selected, item]);
    }
  };

  const handleAddNew = async () => {
    if (!newItem.trim() || !onAddNew) return;

    setAdding(true);
    try {
      await onAddNew(newItem.trim());
      // Auto-select the new item
      onChange([...selected, newItem.trim()]);
      setNewItem('');
      setShowInput(false);
    } catch {
      // Error is handled by the mutation
    } finally {
      setAdding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddNew();
    } else if (e.key === 'Escape') {
      setShowInput(false);
      setNewItem('');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">{title}</h4>
        {allowAdd && !showInput && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowInput(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Adicionar
          </Button>
        )}
      </div>

      {showInput && (
        <div className="flex items-center gap-2">
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder="Nome da nova opção..."
            className="h-8 text-sm"
            onKeyDown={handleKeyDown}
            autoFocus
            disabled={adding}
          />
          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={handleAddNew}
            disabled={!newItem.trim() || adding}
          >
            {adding ? '...' : 'OK'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => {
              setShowInput(false);
              setNewItem('');
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : options.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          Nenhuma opção disponível. Adicione a primeira!
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const isSelected = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => toggleItem(option)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-sm font-medium transition-all",
                  "border-2 focus:outline-none focus:ring-2 focus:ring-primary/20",
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-white/[0.045] text-muted-foreground border-white/[0.055] hover:border-primary/50 hover:text-foreground"
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
