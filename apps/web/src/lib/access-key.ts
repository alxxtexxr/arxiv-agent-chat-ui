const ACCESS_KEY_STORAGE = "lg:chat:accessKey";

export function storeAccessKey(key: string) {
  localStorage.setItem(ACCESS_KEY_STORAGE, key);
}

export function getStoredAccessKey(): string | null {
  return localStorage.getItem(ACCESS_KEY_STORAGE);
}

export function clearAccessKey() {
  localStorage.removeItem(ACCESS_KEY_STORAGE);
}

export function isAdminKey(): boolean {
  const stored = getStoredAccessKey();
  if (!stored) return false;

  const raw = import.meta.env.VITE_ADMIN_KEYS as string | undefined;
  if (!raw) return false;

  const adminKeys = raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  return adminKeys.includes(stored);
}
