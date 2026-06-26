import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, LucideIcon } from 'lucide-react';

interface TabIntroCardProps {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  tips?: string[];
}

export function TabIntroCard({ id, icon: Icon, title, description, tips }: TabIntroCardProps) {
  const storageKey = `crm-intro-dismissed-${id}`;
  const [isDismissed, setIsDismissed] = useState(true); // Start hidden to avoid flash

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      const dismissed = localStorage.getItem(storageKey);
      setIsDismissed(dismissed === 'true');
    });

    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const handleDismiss = () => {
    localStorage.setItem(storageKey, 'true');
    setIsDismissed(true);
  };

  if (isDismissed) return null;

  return (
    <Card className="app-card mb-6 border-primary/20 bg-primary/[0.045]">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-4">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-medium text-sm">{title}</h4>
                <p className="text-sm text-muted-foreground mt-1">{description}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={handleDismiss}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {tips && tips.length > 0 && (
              <ul className="mt-2 space-y-1">
                {tips.map((tip, index) => (
                  <li key={index} className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-primary/50" />
                    {tip}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
