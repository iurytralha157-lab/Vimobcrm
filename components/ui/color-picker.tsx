import { useState, useRef } from 'react';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Button } from './button';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

const presetColors = [
  '#0891b2', '#3b82f6', '#8b5cf6', '#ec4899', '#22c55e', '#f59e0b',
  '#ef4444', '#14b8a6', '#6366f1', '#f43f5e', '#84cc16', '#06b6d4',
  '#a855f7', '#eab308', '#10b981', '#f97316', '#0ea5e9', '#d946ef',
];

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    if (/^#[0-9A-Fa-f]{0,6}$/.test(newValue)) {
      onChange(newValue);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start gap-3">
          <div
            className="w-6 h-6 rounded-md border border-border"
            style={{ backgroundColor: value }}
          />
          <span className="font-mono text-sm">{value}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <div className="space-y-3">
          {/* Color input */}
          <div className="flex gap-2">
            <div
              className="w-12 h-10 rounded-md border border-border cursor-pointer"
              style={{ backgroundColor: value }}
              onClick={() => inputRef.current?.click()}
            />
            <input
              ref={inputRef}
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="sr-only"
            />
            <Input
              value={value}
              onChange={handleInputChange}
              placeholder="#000000"
              className="font-mono text-sm flex-1"
            />
          </div>

          {/* Preset colors */}
          <div className="grid grid-cols-6 gap-1.5">
            {presetColors.map((color) => (
              <button
                key={color}
                className={`w-8 h-8 rounded-md border-2 transition-transform hover:scale-110 ${
                  value === color ? 'border-foreground' : 'border-transparent'
                }`}
                style={{ backgroundColor: color }}
                onClick={() => {
                  onChange(color);
                  setIsOpen(false);
                }}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
