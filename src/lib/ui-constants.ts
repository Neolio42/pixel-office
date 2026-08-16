export const STATE_COLORS: Record<string, string> = {
  idle: '#444',
  typing: '#4a7cbf',
  reading: '#4abf5c',
  waiting: '#bf8b4a',
  walking: '#8b4abf',
  thinking: '#d6c14a',
  done: '#5a8a9a',
  error: '#bf4a4a',
};

export const STATE_ICONS: Record<string, string> = {
  idle: '·',
  typing: '▌',
  reading: '◎',
  waiting: '◈',
  walking: '→',
  thinking: '✻',
  done: '✓',
  error: '✗',
};

export const STATE_LABEL: Record<string, string> = {
  idle: 'Idle',
  typing: 'Working',
  reading: 'Searching',
  waiting: 'Needs you',
  walking: 'Arriving',
  thinking: 'Thinking',
  done: 'Done',
  error: 'Error',
};
