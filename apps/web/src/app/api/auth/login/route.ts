import { NextResponse } from 'next/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';

export async function POST(request: Request) {
  if (!API_URL) {
    return NextResponse.json(
      { error: 'API_URL not configured' },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const res = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: 'Unable to reach API server' },
      { status: 502 },
    );
  }
}
