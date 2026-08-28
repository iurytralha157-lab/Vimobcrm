import React, { useEffect, useRef, useMemo } from 'react';
import { Player } from '@lordicon/react';
import { useTheme } from 'next-themes';

interface AnimatedIconProps {
  icon: object;
  size?: number;
  trigger?: 'hover' | 'click' | 'loop' | 'morph' | 'loop-on-hover';
  className?: string;
  colors?: {
    primary?: string;
    secondary?: string;
  };
}

/**
 * A generic reusable animated Lordicon component.
 * Automatically switches between light/dark mode for the primary color.
 */
export const AnimatedIcon: React.FC<AnimatedIconProps> = ({
  icon,
  size = 24,
  trigger = 'hover',
  className = '',
  colors: customColors = {}
}) => {
  const playerRef = useRef<Player>(null);
  const { resolvedTheme } = useTheme();

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
  }, [trigger, icon]);

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
        icon={icon}
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
