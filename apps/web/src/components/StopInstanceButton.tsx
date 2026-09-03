import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2, Power, X } from "lucide-react";
import { clearAccessKey, getStoredAccessKey } from "@/lib/access-key";
import { toast } from "sonner";
import { TooltipIconButton } from "@/components/thread/tooltip-icon-button";
import { Button } from "@/components/ui/button";

const INSTANCE_CONTROL_PROXY = import.meta.env
  .VITE_INSTANCE_CONTROL_PROXY_URL as string;

export function StopInstanceButton() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [stopping, setStopping] = useState(false);

  const handleStop = async () => {
    setStopping(true);
    const accessKey = getStoredAccessKey() || "";
    const headers: Record<string, string> = { "X-Access-Key": accessKey };
    try {
      const res = await fetch(
        `${INSTANCE_CONTROL_PROXY}?path=/v1/instances/arxiv-agent/stop`,
        {
          method: "POST",
          headers,
        },
      );
      if (!res.ok) throw new Error(`Stop returned ${res.status}`);

      // Poll until instance is fully stopped
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 3_000));
        const statusRes = await fetch(
          `${INSTANCE_CONTROL_PROXY}?path=/v1/instances/arxiv-agent/status`,
          { headers },
        );
        if (statusRes.ok) {
          const data = await statusRes.json();
          if (data.state === "stopped") break;
        }
      }

      clearAccessKey();
      localStorage.removeItem("lg:chat:apiUrl");
      localStorage.removeItem("lg:chat:assistantId");

      const params = new URLSearchParams(window.location.search);
      params.delete("threadId");
      const search = params.toString();
      window.location.replace(
        window.location.pathname + (search ? `?${search}` : ""),
      );
    } catch (err: any) {
      toast.error("Failed to end session", {
        description: err?.message || "Unknown error",
      });
      setStopping(false);
    }
  };

  return (
    <>
      <TooltipIconButton
        tooltip="End session"
        size="lg"
        className="p-4"
        onClick={() => setShowConfirm(true)}
      >
        {stopping ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Power className="size-5" />
        )}
      </TooltipIconButton>

      <DialogPrimitive.Root open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            onOpenAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => {
              if (stopping) e.preventDefault();
            }}
            onEscapeKeyDown={(e) => {
              if (stopping) e.preventDefault();
            }}
            className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg"
          >
            <div className="flex flex-row items-center justify-between space-y-0">
              <DialogPrimitive.Title className="text-lg font-semibold">
                End session?
              </DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
                <button
                  disabled={stopping}
                  className="rounded-md p-1.5 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                >
                  <X className="size-5" />
                  <span className="sr-only">Close</span>
                </button>
              </DialogPrimitive.Close>
            </div>
            <DialogPrimitive.Description className="text-sm text-muted-foreground">
              This will end your current session. You'll need to enter your
              access key again to continue.
            </DialogPrimitive.Description>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <DialogPrimitive.Close asChild>
                <Button variant="outline" disabled={stopping}>
                  Cancel
                </Button>
              </DialogPrimitive.Close>
              <Button
                onClick={handleStop}
                disabled={stopping}
                className="bg-rose-600 hover:bg-rose-700 text-white"
              >
                {stopping ? "Ending…" : "End session"}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
