import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const data = await request.json();

    const { type, name, email, organization, message } = data;
    if (!name || !email || !organization || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // In production, send via SendGrid/Resend
    // For now, log and return success
    console.log('[Contact Form]', { type, name, email, organization, message: message.substring(0, 100) });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
