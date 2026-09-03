import React, { ReactNode, useState, useEffect, useCallback } from "react";
import { useQueryState } from "nuqs";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { storeAccessKey } from "@/lib/access-key";

const PROXY_URL = import.meta.env.VITE_PROXY_URL as string;
const STORAGE_KEY = "lg:chat:apiUrl";
const ASSISTANT_ID_DEFAULT = "agent";
const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT || "2024";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 60; // 5 min max
const WARMUP_POLL_MS = 7_500;
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

function getKeyFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("key");
}

type StatusResult =
  { state: "running"; publicIp: string } | { state: string; publicIp?: string };

/** Check instance status via the /status endpoint. */
async function fetchInstanceStatus(accessKey: string): Promise<StatusResult> {
  const headers: Record<string, string> = {
    "X-Access-Key": accessKey,
  };

  const res = await fetch(
    `${PROXY_URL}?path=/v1/instances/arxiv-agent/status`,
    {
      headers,
    },
  );
  if (!res.ok) throw new Error(`Status check returned ${res.status}`);
  const data = await res.json();
  return { state: data.state, publicIp: data.publicIp };
}

/** Fire-and-forget: tell the instance to start. */
async function triggerStart(accessKey: string): Promise<void> {
  const headers: Record<string, string> = {
    "X-Access-Key": accessKey,
  };

  await fetch(`${PROXY_URL}?path=/v1/instances/arxiv-agent/start`, {
    method: "POST",
    headers,
  });
}

/** Poll /status until running or timeout. Returns the public IP. */
async function pollUntilRunning(
  accessKey: string,
  onStatus?: (state: string) => void,
): Promise<string> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const result = await fetchInstanceStatus(accessKey);
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

/** Poll /status until stopped or timeout. */
async function pollUntilStopped(
  accessKey: string,
  onStatus?: (state: string) => void,
): Promise<void> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const result = await fetchInstanceStatus(accessKey);
    onStatus?.(result.state);

    if (result.state === "stopped") return;

    if (
      result.state === "terminated" ||
      result.state === "shutting-down" ||
      result.state === "terminating"
    ) {
      throw new Error(`Instance is ${result.state}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error("Timed out waiting for backend to stop");
}

/** After instance is running, wait for the LangGraph server to be ready. */
async function waitForLangGraph(
  publicIp: string,
  onStatus?: (msg: string) => void,
): Promise<void> {
  const url = `http://${publicIp}:${BACKEND_PORT}/info`;
  const messages = [
    "Working on it…",
    "Still setting up…",
    "Almost there…",
    "Just a few more seconds…",
  ];

  for (let i = 0; i < WARMUP_MAX_ATTEMPTS; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return;
    } catch {
      // Server not ready yet — keep polling.
    }
    onStatus?.(messages[Math.min(i + 1, messages.length - 1)]);
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
    triggerStart(keyFromUrl).catch(() => {});
  }, [keyFromUrl]);
}

type GatePhase = "idle" | "checking" | "preparing" | "waiting" | "warming";

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
    fetchInstanceStatus(keyFromUrl!)
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
          <p className="text-muted-foreground">Checking session…</p>
        </div>
      </div>
    );
  }

  // Waiting for instance to reach "running" or services to warm up
  if (phase === "preparing" || phase === "waiting" || phase === "warming") {
    return (
      <div className="flex items-center justify-center min-h-screen w-full p-4">
        <div className="animate-in fade-in-0 zoom-in-95 flex flex-col border bg-background shadow-lg rounded-lg max-w-3xl">
          <div className="flex flex-col gap-2 p-6 border-b">
            <div className="flex items-start flex-col gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                arXiv Agent
              </h1>
            </div>
            <p className="text-muted-foreground">
              Setting up your session. This usually takes about a minute.
            </p>
          </div>
          <div className="flex flex-col items-center gap-4 p-10 bg-muted/50">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {phase === "preparing"
                ? "Preparing…"
                : phase === "warming"
                  ? warmMessage || "Almost ready…"
                  : instanceState === "pending"
                    ? "Setting up…"
                    : instanceState === "stopping"
                      ? "Shutting down previous session…"
                      : "Setting up…"}
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

    setPhase("preparing");
    await new Promise((r) => setTimeout(r, 1_500));
    setPhase("waiting");
    setInstanceState("");

    try {
      // Check current status before doing anything
      const current = await fetchInstanceStatus(accessKey);

      if (current.state === "running" && current.publicIp) {
        // Already running — skip start, go straight to LangGraph check
      } else if (current.state === "stopping") {
        // Wait for it to fully stop, then start it
        setInstanceState("stopping");
        await pollUntilStopped(accessKey, (state) => setInstanceState(state));
        triggerStart(accessKey).catch(() => {});
        const publicIp = await pollUntilRunning(accessKey, (state) =>
          setInstanceState(state),
        );
        setWarmMessage("Working on it…");
        setPhase("warming");
        await waitForLangGraph(publicIp, (msg) => setWarmMessage(msg));
        storeAccessKey(accessKey);
        goToChat(publicIp);
        setUrlKey(null);
        return;
      } else if (current.state === "pending") {
        // Already starting — just wait for it
        setInstanceState("pending");
        const publicIp = await pollUntilRunning(accessKey, (state) =>
          setInstanceState(state),
        );
        setWarmMessage("Working on it…");
        setPhase("warming");
        await waitForLangGraph(publicIp, (msg) => setWarmMessage(msg));
        storeAccessKey(accessKey);
        goToChat(publicIp);
        setUrlKey(null);
        return;
      } else {
        // Stopped or unknown — start it
        triggerStart(accessKey).catch(() => {});
        const publicIp = await pollUntilRunning(accessKey, (state) =>
          setInstanceState(state),
        );
        setWarmMessage("Working on it…");
        setPhase("warming");
        await waitForLangGraph(publicIp, (msg) => setWarmMessage(msg));
        storeAccessKey(accessKey);
        goToChat(publicIp);
        setUrlKey(null);
        return;
      }

      // Running — check LangGraph directly
      const publicIp = current.publicIp!;

      setWarmMessage("Working on it…");
      setPhase("warming");
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
        <div className="flex flex-col gap-2 p-6 border-b">
          <div className="flex items-start flex-col gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              arXiv Agent
            </h1>
          </div>
          <p className="text-muted-foreground">
            Enter your access key to set up your session.
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-6 p-6 bg-muted/50"
        >
          <div className="flex flex-col gap-2">
            <label
              htmlFor="accessKey"
              className="text-sm leading-none font-medium"
            >
              Access Key<span className="text-rose-500">*</span>
            </label>
            <Input
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
