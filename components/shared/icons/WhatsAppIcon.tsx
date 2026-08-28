import React, { useEffect, useRef, useMemo } from 'react';
import { Player } from '@lordicon/react';
import { WHATSAPP_CONVERSATION_JSON, WHATSAPP_LOGO_JSON } from './LordIconsJson';
import { useTheme } from 'next-themes';

interface WhatsAppIconProps {
  size?: number;
  trigger?: 'hover' | 'click' | 'loop' | 'morph' | 'loop-on-hover';
  className?: string;
  variant?: 'conversation' | 'logo';
  colors?: {
    primary?: string;
    secondary?: string;
  };
}

/**
 * A reusable animated WhatsApp icon component using Lordicon.
 * Automatically switches between light/dark mode colors and includes requested orange details.
 */
export const WhatsAppIcon: React.FC<WhatsAppIconProps> = ({
  size = 24,
  trigger = 'hover',
  className = '',
  variant = 'conversation',
  colors: customColors = {}
}) => {
  const playerRef = useRef<Player>(null);
  const { resolvedTheme } = useTheme();

  const iconData = variant === 'logo' ? WHATSAPP_LOGO_JSON : WHATSAPP_CONVERSATION_JSON;

  const colors = useMemo(() => {
    const rootStyles =
      typeof window !== 'undefined' && resolvedTheme
        ? window.getComputedStyle(document.documentElement)
        : null;
    const tokenColor = (token: string) =>
      rootStyles?.getPropertyValue(token).trim() || 'currentColor';

    return {
      primary: customColors.primary || tokenColor('--app-text-primary'),
      secondary: customColors.secondary || tokenColor('--vimob-accent')
    };
  }, [resolvedTheme, customColors]);

  useEffect(() => {
    if (trigger === 'loop' || trigger === 'loop-on-hover') {
      playerRef.current?.playFromBeginning();
    }
  }, [trigger, variant]);

  const handleMouseEnter = () => {
    if (trigger === 'hover' || trigger === 'loop-on-hover') {
      playerRef.current?.playFromBeginning();
    }
  };

  return (
    <div
      className={`inline-flex items-center justify-center ${className}`}
      onMouseEnter={handleMouseEnter}
      style={{ width: size, height: size }}
    >
      <Player
        ref={playerRef}
        icon={iconData}
        size={size}
        onComplete={() => {
          if (trigger === 'loop') {
            playerRef.current?.playFromBeginning();
          }
        }}
        colors={`primary:${colors.primary},secondary:${colors.secondary}`}
      />
    </div>
  );
};
