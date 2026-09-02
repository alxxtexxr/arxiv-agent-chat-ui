import React, { ReactNode, useState, useEffect, useCallback } from "react";
import { useQueryState } from "nuqs";
import { Button } from "@/components/ui/button";
import { LangGraphLogoSVG } from "@/components/icons/langgraph";
import { Label } from "@/components/ui/label";
import { ArrowRight, Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { storeAccessKey } from "@/lib/access-key";

const INSTANCE_CONTROL_BASE =
  "https://instance-control-api.alimtegar404.workers.dev/v1/instances/arxiv-agent";
const STORAGE_KEY = "lg:chat:apiUrl";
const ASSISTANT_ID_DEFAULT = "agent";
const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT || "2024";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 60; // 5 min max
const WARMUP_DELAY_MS = 5_000; // wait for systemd services after instance runs
const WARMUP_POLL_MS = 3_000;
const WARMUP_MAX_ATTEMPTS = 30; // 90s max for services to start

function getStoredApiUrl(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

function setStoredApiUrl(url: string) {
  localStorage.setItem(STORAGE_KEY, url);
}

function clearStoredApiUrl() {
  localStorage.removeItem(STORAGE_KEY);
}

function getApiKeyHeader(): Record<string, string> {
  const apiKey = import.meta.env.VITE_INSTANCE_CONTROL_API_KEY as
    string | undefined;
  return apiKey ? { "X-API-Key": apiKey } : {};
}

function getAllowedKeys(): string[] {
  const raw = import.meta.env.VITE_ALLOWED_KEYS as string | undefined;
  const admin = import.meta.env.VITE_ADMIN_KEYS as string | undefined;
  const keys = new Set<string>();
  if (raw)
    raw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .forEach((k) => keys.add(k));
  if (admin)
    admin
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .forEach((k) => keys.add(k));
  return [...keys];
}

function getKeyFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("key");
}

type StatusResult =
  { state: "running"; publicIp: string } | { state: string; publicIp?: string };

/** Check instance status via the /status endpoint. */
async function fetchInstanceStatus(): Promise<StatusResult> {
  const res = await fetch(`${INSTANCE_CONTROL_BASE}/status`, {
    headers: getApiKeyHeader(),
  });
  if (!res.ok) throw new Error(`Status check returned ${res.status}`);
  const data = await res.json();
  return { state: data.state, publicIp: data.publicIp };
}

/** Fire-and-forget: tell the instance to start. */
async function triggerStart(): Promise<void> {
  await fetch(`${INSTANCE_CONTROL_BASE}/start`, {
    method: "POST",
    headers: getApiKeyHeader(),
  });
}

/** Poll /status until running or timeout. Returns the public IP. */
async function pollUntilRunning(
  onStatus?: (state: string) => void,
): Promise<string> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const result = await fetchInstanceStatus();
    onStatus?.(result.state);

    if (result.state === "running" && result.publicIp) {
      return result.publicIp;
    }

    if (
      result.state === "terminated" ||
      result.state === "shutting-down" ||
      result.state === "terminating"
    ) {
      throw new Error(`Instance is ${result.state}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error("Timed out waiting for backend to start");
}

/** After instance is running, wait for the LangGraph server to be ready. */
async function waitForLangGraph(
  publicIp: string,
  onStatus?: (msg: string) => void,
): Promise<void> {
  const url = `http://${publicIp}:${BACKEND_PORT}/info`;

  onStatus?.("Starting services…");
  await new Promise((r) => setTimeout(r, WARMUP_DELAY_MS));

  for (let i = 0; i < WARMUP_MAX_ATTEMPTS; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return;
    } catch {
      // Server not ready yet — keep polling.
    }
    onStatus?.("Waiting for services to start…");
    await new Promise((r) => setTimeout(r, WARMUP_POLL_MS));
  }

  throw new Error("Backend services did not start in time");
}

// Starts EC2 on mount when ?key= is present and no stored session.
function usePreStart(keyFromUrl: string | null) {
  useEffect(() => {
    if (!keyFromUrl) return;
    if (getStoredApiUrl()) return;
    if (sessionStorage.getItem("prestart-triggered")) return;
    sessionStorage.setItem("prestart-triggered", "1");
    triggerStart().catch(() => {});
  }, [keyFromUrl]);
}

type GatePhase = "idle" | "checking" | "waiting" | "warming";

export const AccessGate: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [storedUrl, setStoredUrl] = useState<string | null>(getStoredApiUrl);
  const [phase, setPhase] = useState<GatePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [instanceState, setInstanceState] = useState<string>("");
  const [warmMessage, setWarmMessage] = useState<string>("");

  const [, setUrlKey] = useQueryState("key");
  const keyFromUrl = getKeyFromUrl();

  usePreStart(keyFromUrl);

  const goToChat = useCallback((ip: string) => {
    const url = `http://${ip}:${BACKEND_PORT}`;
    setStoredApiUrl(url);
    setStoredUrl(url);
    setPhase("idle");
  }, []);

  // On mount: if we have a stored URL, verify the instance is still running.
  useEffect(() => {
    if (!storedUrl) return;

    setPhase("checking");
    fetchInstanceStatus()
      .then((result) => {
        if (result.state === "running" && result.publicIp) {
          const freshUrl = `http://${result.publicIp}:${BACKEND_PORT}`;
          setStoredApiUrl(freshUrl);
          setStoredUrl(freshUrl);
        } else {
          clearStoredApiUrl();
          setStoredUrl(null);
        }
      })
      .catch(() => {
        clearStoredApiUrl();
        setStoredUrl(null);
      })
      .finally(() => setPhase("idle"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Loading state while checking instance status
  if (phase === "checking") {
    return (
      <div className="flex items-center justify-center min-h-screen w-full p-4">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Checking backend status…</p>
        </div>
      </div>
    );
  }

  // Waiting for instance to reach "running" or services to warm up
  if (phase === "waiting" || phase === "warming") {
    return (
      <div className="flex items-center justify-center min-h-screen w-full p-4">
        <div className="animate-in fade-in-0 zoom-in-95 flex flex-col border bg-background shadow-lg rounded-lg max-w-3xl">
          <div className="flex flex-col gap-2 mt-14 p-6 border-b">
            <div className="flex items-start flex-col gap-2">
              <LangGraphLogoSVG className="h-7" />
              <h1 className="text-xl font-semibold tracking-tight">
                Agent Chat
              </h1>
            </div>
            <p className="text-muted-foreground">
              {phase === "warming"
                ? "Backend is starting up. Almost ready…"
                : "Starting the backend instance. This may take a minute…"}
            </p>
          </div>
          <div className="flex flex-col items-center gap-4 p-10 bg-muted/50">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {phase === "warming"
                ? warmMessage || "Waiting for services…"
                : instanceState === "pending"
                  ? "Instance is booting up…"
                  : instanceState === "stopping"
                    ? "Previous instance is shutting down…"
                    : `Instance state: ${instanceState || "unknown"}…`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // If we have a valid stored URL, skip the gate
  if (storedUrl) {
    localStorage.setItem("lg:chat:assistantId", ASSISTANT_ID_DEFAULT);
    return <>{children}</>;
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const accessKey = (formData.get("accessKey") as string)?.trim();

    if (!accessKey) {
      setError("Access key is required.");
      return;
    }

    const allowed = getAllowedKeys();
    if (allowed.length > 0 && !allowed.includes(accessKey)) {
      setError("Invalid access key.");
      return;
    }

    setPhase("waiting");
    setInstanceState("");

    try {
      triggerStart().catch(() => {});

      const publicIp = await pollUntilRunning((state) =>
        setInstanceState(state),
      );

      setPhase("warming");
      setWarmMessage("Starting services…");
      await waitForLangGraph(publicIp, (msg) => setWarmMessage(msg));

      storeAccessKey(accessKey);
      goToChat(publicIp);
      setUrlKey(null);
    } catch (err: any) {
      setError(err?.message || "Failed to start the backend. Try again.");
      setPhase("idle");
    }
  };

  const defaultKey = keyFromUrl || "";

  return (
    <div className="flex items-center justify-center min-h-screen w-full p-4">
      <div className="animate-in fade-in-0 zoom-in-95 flex flex-col border bg-background shadow-lg rounded-lg max-w-3xl">
        <div className="flex flex-col gap-2 mt-14 p-6 border-b">
          <div className="flex items-start flex-col gap-2">
            <LangGraphLogoSVG className="h-7" />
            <h1 className="text-xl font-semibold tracking-tight">Agent Chat</h1>
          </div>
          <p className="text-muted-foreground">
            Enter your access key to continue.
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-6 p-6 bg-muted/50"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="accessKey">
              Access Key<span className="text-rose-500">*</span>
            </Label>
            <PasswordInput
              id="accessKey"
              name="accessKey"
              className="bg-background"
              defaultValue={defaultKey}
              placeholder="Enter your access key"
              autoFocus
            />
          </div>

          {error && <p className="text-sm text-rose-500">{error}</p>}

          <div className="flex justify-end mt-2">
            <Button type="submit" size="lg">
              Continue
              <ArrowRight className="size-5" />
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AccessGate;
