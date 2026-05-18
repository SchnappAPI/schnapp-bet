'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  delayMs?: number;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  delayMs = 200,
  className,
  onOpenChange,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayMs}>
      <TooltipPrimitive.Root onOpenChange={onOpenChange}>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={8}
            className={cn(
              'z-50 rounded border border-border-strong bg-surface px-2 py-1.5',
              'text-[11px] text-fg shadow-pop',
              'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
              'data-[state=delayed-open]:fade-in-0 data-[state=closed]:fade-out-0',
              className
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
