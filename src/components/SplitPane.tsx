'use client';

import { useRef, useCallback, useState } from 'react';

interface SplitPaneProps {
  direction: 'horizontal' | 'vertical';
  first: React.ReactNode;
  second: React.ReactNode;
  defaultRatio?: number; // 0-1, percentage for first child
  onRatioChange?: (ratio: number) => void;
  minRatio?: number;
}

export function SplitPane({
  direction,
  first,
  second,
  defaultRatio = 0.5,
  onRatioChange,
  minRatio = 0.15,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(defaultRatio);
  const dragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let newRatio: number;

      if (direction === 'horizontal') {
        newRatio = (ev.clientX - rect.left) / rect.width;
      } else {
        newRatio = (ev.clientY - rect.top) / rect.height;
      }

      newRatio = Math.max(minRatio, Math.min(1 - minRatio, newRatio));
      setRatio(newRatio);
      onRatioChange?.(newRatio);
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [direction, minRatio, onRatioChange]);

  const firstPercent = `${ratio * 100}%`;
  const secondPercent = `${(1 - ratio) * 100}%`;
  const isHorizontal = direction === 'horizontal';

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 min-w-0"
      style={{ flexDirection: isHorizontal ? 'row' : 'column' }}
    >
      <div style={{ [isHorizontal ? 'width' : 'height']: firstPercent, flexShrink: 0 }} className="min-h-0 min-w-0">
        {first}
      </div>
      <div
        onMouseDown={handleMouseDown}
        className={`flex-shrink-0 group relative z-10 ${
          isHorizontal
            ? 'w-[3px] cursor-col-resize hover:w-[5px]'
            : 'h-[3px] cursor-row-resize hover:h-[5px]'
        } transition-all duration-100`}
      >
        <div className={`absolute inset-0 bg-[#2a2a4a] group-hover:bg-[#4a4a7a] transition-colors ${
          isHorizontal ? 'left-0 right-0' : 'top-0 bottom-0'
        }`} />
      </div>
      <div style={{ [isHorizontal ? 'width' : 'height']: secondPercent }} className="flex-1 min-h-0 min-w-0">
        {second}
      </div>
    </div>
  );
}
