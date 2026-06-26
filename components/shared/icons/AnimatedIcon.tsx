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
    const isDark = resolvedTheme === 'dark';
    return {
      primary: customColors.primary || (isDark ? '#f8fafc' : '#121212'),
      secondary: customColors.secondary || '#ed492f'
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
