'use client';

import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

interface NotificationSoundControlsProps {
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  onTest: () => Promise<boolean>;
  ready: boolean;
}

type TestState = 'idle' | 'testing' | 'success' | 'failure';

const soundControlClassName = 'h-8 gap-1 rounded-[6px] border-0 px-1.5 text-[11px] font-light shadow-none ring-0 ring-offset-0 hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)] focus-visible:bg-[var(--app-surface-hover)] focus-visible:ring-0 focus-visible:ring-offset-0 sm:h-7 [&_svg]:size-3.5';

export function NotificationSoundControls({ muted, onMutedChange, onTest, ready }: NotificationSoundControlsProps) {
  const [testState, setTestState] = useState<TestState>('idle');
  const testInFlight = useRef(false);
  const mounted = useRef(true);
  const testing = testState === 'testing';
  const muteLabel = muted ? 'Ativar som de novos leads' : 'Silenciar som de novos leads';

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const handleTest = async () => {
    if (testInFlight.current) return;
    testInFlight.current = true;
    setTestState('testing');
    try {
      // Invoke directly from the click so the audio owner can unlock playback.
      const played = await onTest();
      if (mounted.current) setTestState(played ? 'success' : 'failure');
    } catch {
      if (mounted.current) setTestState('failure');
    } finally {
      testInFlight.current = false;
    }
  };

  return (
    <div role="group" aria-label="Som de novos leads" className="notification-sound-controls flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-1 gap-y-1 font-sans text-[11px] font-light">
      <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={muteLabel}
          title={muteLabel}
          className={soundControlClassName}
          onClick={() => onMutedChange(!muted)}
        >
          {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          {muted ? 'Ativar som' : 'Silenciar som'}
        </Button>
      </DropdownMenuItem>
      <DropdownMenuItem asChild disabled={testing} onSelect={(event) => event.preventDefault()}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Testar som"
          aria-busy={testing}
          disabled={testing}
          className={soundControlClassName}
          onClick={() => { void handleTest(); }}
        >
          {testing ? 'Testando...' : 'Testar som'}
        </Button>
      </DropdownMenuItem>
      {!ready && <p className="w-full text-right text-[10px] font-light leading-[14px] text-muted-foreground">Para ativar o áudio, toque em Testar som.</p>}
      <p role="status" aria-live="polite" aria-atomic="true" className={testState === 'success' || testState === 'failure' ? 'w-full text-right text-[10px] font-light leading-[14px] text-muted-foreground' : 'sr-only'}>
        {testState === 'success' ? 'Som reproduzido.' : testState === 'failure' ? 'Não foi possível reproduzir o som. Tente novamente.' : ''}
      </p>
    </div>
  );
}
