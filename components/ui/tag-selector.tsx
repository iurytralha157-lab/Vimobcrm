import { useState, useRef, useEffect } from 'react';
import { useTags, useCreateTag } from '@/hooks/use-tags';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, X, Check, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

// Predefined colors for quick tag creation
const TAG_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
];

interface TagSelectorProps {
  /** Currently selected tag IDs */
  selectedTagIds: string[];
  /** Callback when a tag is selected */
  onSelectTag: (tagId: string) => void;
  /** Callback when a tag is removed (optional) */
  onRemoveTag?: (tagId: string) => void;
  /** Whether to allow multiple selections */
  multiple?: boolean;
  /** Whether to show selected tags as badges */
  showSelectedBadges?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Custom class for the trigger */
  triggerClassName?: string;
  /** Compact mode - just show a + button */
  compact?: boolean;
  /** Disabled state */
  disabled?: boolean;
}

export function TagSelector({
  selectedTagIds,
  onSelectTag,
  onRemoveTag,
  multiple = true,
  showSelectedBadges = true,
  placeholder = 'Selecionar tags...',
  triggerClassName,
  compact = false,
  disabled = false
}: TagSelectorProps) {
  const { data: allTags = [], isLoading: tagsLoading } = useTags();
  const createTag = useCreateTag();

  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter tags based on search
  const filteredTags = allTags.filter(tag =>
    tag.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Check if search term matches exactly an existing tag
  const exactMatch = allTags.some(
    tag => tag.name.toLowerCase() === searchTerm.toLowerCase()
  );

  // Get selected tags for display
  const selectedTags = allTags.filter(tag => selectedTagIds.includes(tag.id));

  // Available tags (not selected)
  const availableTags = multiple
    ? filteredTags.filter(tag => !selectedTagIds.includes(tag.id))
    : filteredTags;

  const handleCreateTag = async () => {
    if (!searchTerm.trim() || exactMatch) return;

    setIsCreating(true);
    try {
      // Pick a random color from the palette
      const randomColor = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];

      const newTag = await createTag.mutateAsync({
        name: searchTerm.trim(),
        color: randomColor
      });

      if (newTag?.id) {
        onSelectTag(newTag.id);
      }
      setSearchTerm('');
    } catch {
      // Error handled by mutation
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchTerm.trim() && !exactMatch) {
      e.preventDefault();
      handleCreateTag();
    }
  };

  // Focus input when popover opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Selected tags badges */}
      {showSelectedBadges && selectedTags.map(tag => (
        <Badge
          key={tag.id}
          className="flex items-center gap-1 rounded-[4px] border-0 py-0.5 pr-1 text-xs"
          style={{
            backgroundColor: `${tag.color}15`,
            color: tag.color,
            borderColor: `${tag.color}30`
          }}
        >
          <div
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: tag.color }}
          />
          {tag.name}
          {onRemoveTag && (
            <button
              onClick={() => onRemoveTag(tag.id)}
              className="ml-0.5 rounded-[3px] p-0.5 hover:bg-black/10"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </Badge>
      ))}

      {/* Popover trigger */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {compact ? (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-xs",
                triggerClassName
              )}
              disabled={disabled}
            >
              <Plus className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 px-3 text-xs gap-1",
                selectedTags.length === 0 && "text-muted-foreground",
                triggerClassName
              )}
              disabled={disabled}
            >
              <Plus className="h-3 w-3" />
              {selectedTags.length === 0 ? placeholder : 'Adicionar'}
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          {/* Search input */}
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={inputRef}
                placeholder="Buscar ou criar tag..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>

          {/* Tags list */}
          <ScrollArea className="max-h-48">
            <div className="p-2 space-y-1">
              {tagsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* Create new tag option */}
                  {searchTerm.trim() && !exactMatch && (
                    <button
                      onClick={handleCreateTag}
                      disabled={isCreating}
                      className="w-full flex items-center gap-2 rounded-[6px] bg-primary/10 px-2 py-1.5 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/20"
                    >
                      {isCreating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      Criar &quot;{searchTerm.trim()}&quot;
                    </button>
                  )}

                  {/* Existing tags */}
                  {availableTags.length > 0 ? (
                    availableTags.map(tag => (
                      <button
                        key={tag.id}
                        onClick={() => {
                          onSelectTag(tag.id);
                          if (!multiple) setOpen(false);
                          setSearchTerm('');
                        }}
                        className="w-full flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="flex-1 truncate">{tag.name}</span>
                        {selectedTagIds.includes(tag.id) && (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        )}
                      </button>
                    ))
                  ) : (
                    !searchTerm.trim() && (
                      <p className="text-sm text-muted-foreground text-center py-3 px-2">
                        Digite acima para criar uma nova tag
                      </p>
                    )
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Simpler inline tag selector for forms - shows all tags with toggle
 */
interface InlineTagSelectorProps {
  selectedTagIds: string[];
  onToggleTag: (tagId: string) => void;
  className?: string;
}

export function InlineTagSelector({
  selectedTagIds,
  onToggleTag,
  className
}: InlineTagSelectorProps) {
  const { data: allTags = [], isLoading } = useTags();
  const createTag = useCreateTag();

  const [newTagName, setNewTagName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;

    // Check if tag already exists
    const exists = allTags.some(
      t => t.name.toLowerCase() === newTagName.toLowerCase()
    );
    if (exists) {
      setNewTagName('');
      return;
    }

    setIsCreating(true);
    try {
      const randomColor = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
      const newTag = await createTag.mutateAsync({
        name: newTagName.trim(),
        color: randomColor
      });

      if (newTag?.id) {
        onToggleTag(newTag.id);
      }
      setNewTagName('');
    } catch {
      // Error handled by mutation
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Create new tag input */}
      <div className="flex gap-2">
        <Input
          placeholder="Nome da nova tag..."
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleCreateTag();
            }
          }}
          className="h-8 text-sm flex-1"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={handleCreateTag}
          disabled={!newTagName.trim() || isCreating}
          className="h-8 px-3"
        >
          {isCreating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Tags grid */}
      <div className="flex flex-wrap gap-2">
        {allTags.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma tag disponível. Crie uma acima.
          </p>
        ) : (
          allTags.map(tag => {
            const isSelected = selectedTagIds.includes(tag.id);
            return (
              <Badge
                key={tag.id}
                variant={isSelected ? "default" : "outline"}
                className="cursor-pointer rounded-[4px] transition-colors"
                style={{
                  backgroundColor: isSelected ? tag.color : 'transparent',
                  borderColor: tag.color,
                  color: isSelected ? 'white' : tag.color,
                }}
                onClick={() => onToggleTag(tag.id)}
              >
                {tag.name}
              </Badge>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * Popover content for tag selection with inline creation - for use in custom popovers
 */
interface TagSelectorPopoverContentProps {
  availableTags: Array<{ id: string; name: string; color: string }>;
  onAddTag: (tagId: string) => void;
  onClose: () => void;
}

export function TagSelectorPopoverContent({
  availableTags,
  onAddTag,
  onClose
}: TagSelectorPopoverContentProps) {
  const createTag = useCreateTag();
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const filteredTags = availableTags.filter(tag =>
    tag.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const exactMatch = availableTags.some(
    tag => tag.name.toLowerCase() === searchTerm.toLowerCase()
  );

  const handleCreateTag = async () => {
    if (!searchTerm.trim() || exactMatch) return;

    setIsCreating(true);
    try {
      const randomColor = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
      const newTag = await createTag.mutateAsync({
        name: searchTerm.trim(),
        color: randomColor
      });

      if (newTag?.id) {
        onAddTag(newTag.id);
        onClose();
      }
      setSearchTerm('');
    } catch {
      // Error handled by mutation
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="p-0">
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar ou criar..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchTerm.trim() && !exactMatch) {
                e.preventDefault();
                handleCreateTag();
              }
            }}
            className="h-8 pl-8 text-sm"
            autoFocus
          />
        </div>
      </div>
      <ScrollArea className="max-h-48">
        <div className="p-2 space-y-1">
          {searchTerm.trim() && !exactMatch && (
            <button
              onClick={handleCreateTag}
              disabled={isCreating}
              className="w-full flex items-center gap-2 rounded-[6px] bg-primary/10 px-2 py-1.5 text-left text-sm font-medium text-primary hover:bg-primary/20"
            >
              {isCreating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Criar &quot;{searchTerm.trim()}&quot;
            </button>
          )}
          {filteredTags.length > 0 ? (
            filteredTags.map(tag => (
              <button
                key={tag.id}
                onClick={() => {
                  onAddTag(tag.id);
                  onClose();
                }}
                className="w-full flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </button>
            ))
          ) : !searchTerm.trim() ? (
            <p className="text-sm text-muted-foreground text-center py-3 px-2">
              Digite acima para criar uma nova tag
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
