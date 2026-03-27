import { NextRequest, NextResponse } from 'next/server';
import { getWhitelistRules, addWhitelistRule, removeWhitelistRule } from '@/lib/whitelist';

/** GET /api/whitelist — list all whitelist rules */
export async function GET() {
  return NextResponse.json({ rules: getWhitelistRules() });
}

/** POST /api/whitelist — add a new rule */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { type, entry, label } = body;
  if (!type || !entry) {
    return NextResponse.json({ error: 'type and entry are required' }, { status: 400 });
  }
  const added = addWhitelistRule({ type, entry, label: label || entry });
  return NextResponse.json({ added });
}

/** DELETE /api/whitelist — remove a rule */
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { type, entry } = body;
  if (!type || !entry) {
    return NextResponse.json({ error: 'type and entry are required' }, { status: 400 });
  }
  const removed = removeWhitelistRule(type, entry);
  return NextResponse.json({ removed });
}
