// Simple token storage for MVP — use expo-secure-store for production
let _token: string | null = null;

export async function saveToken(token: string) {
  _token = token;
}

export async function getToken(): Promise<string | null> {
  return _token;
}

export async function clearToken() {
  _token = null;
}
