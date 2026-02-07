import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const data = await request.json();

    const { companyName, contactName, email } = data;
    if (!companyName || !contactName || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // In production, store in database + send via SendGrid/Resend
    console.log('[Membership Application]', { companyName, contactName, email });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
