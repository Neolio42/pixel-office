import { NextRequest, NextResponse } from 'next/server';
import { getRules, addRule, removeRule } from '@/lib/rules';

/** GET /api/rules — list all rules */
export async function GET() {
  return NextResponse.json({ rules: getRules() });
}

/** POST /api/rules — add a new rule */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { pattern, action, label } = body;
  if (!pattern || !action) {
    return NextResponse.json({ error: 'pattern and action are required' }, { status: 400 });
  }
  if (action !== 'allow' && action !== 'deny') {
    return NextResponse.json({ error: 'action must be "allow" or "deny"' }, { status: 400 });
  }
  const added = addRule({ pattern, action, label: label || pattern });
  return NextResponse.json({ added });
}

/** DELETE /api/rules — remove a rule */
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { pattern, action } = body;
  if (!pattern || !action) {
    return NextResponse.json({ error: 'pattern and action are required' }, { status: 400 });
  }
  const removed = removeRule(pattern, action);
  return NextResponse.json({ removed });
}
