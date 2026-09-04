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
  // Check locally cached admin status (set by checkAdminStatus)
  return localStorage.getItem("lg:chat:isAdmin") === "true";
}

const PROXY_URL = import.meta.env.VITE_PROXY_URL as string;

/** Call proxy /auth/check to validate the stored key and cache admin status. */
export async function checkAdminStatus(): Promise<void> {
  const key = getStoredAccessKey();
  if (!key) {
    localStorage.removeItem("lg:chat:isAdmin");
    return;
  }
  try {
    const res = await fetch(`${PROXY_URL}/auth/check`, {
      headers: { "X-Access-Key": key },
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem("lg:chat:isAdmin", String(data.admin));
    } else {
      localStorage.removeItem("lg:chat:isAdmin");
    }
  } catch {
    localStorage.removeItem("lg:chat:isAdmin");
  }
}
