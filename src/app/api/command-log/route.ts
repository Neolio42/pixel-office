import { NextRequest, NextResponse } from 'next/server';
import { getRecentLogs, getPatternStats } from '@/lib/command-log';

/** GET /api/command-log — get recent logs or pattern stats */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const view = url.searchParams.get('view');

  if (view === 'stats') {
    return NextResponse.json({ stats: getPatternStats() });
  }

  const limit = parseInt(url.searchParams.get('limit') || '100', 10);
  return NextResponse.json({ entries: getRecentLogs(limit) });
}
