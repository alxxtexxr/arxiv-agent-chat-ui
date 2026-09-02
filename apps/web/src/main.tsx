import "./index.css";
import App from "./App.tsx";
import { createRoot } from "react-dom/client";
import { StreamProvider } from "./providers/Stream.tsx";
import { AccessGate } from "./providers/AccessGate.tsx";
import { ThreadProvider } from "./providers/Thread.tsx";
import { ThemeProvider } from "./providers/ThemeProvider.tsx";
import { Toaster } from "@/components/ui/sonner";
import { NuqsAdapter } from "nuqs/adapters/react-router/v6";
import { BrowserRouter } from "react-router-dom";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <NuqsAdapter>
      <ThemeProvider>
        <ThreadProvider>
          <AccessGate>
            <StreamProvider>
              <App />
            </StreamProvider>
          </AccessGate>
        </ThreadProvider>
        <Toaster />
      </ThemeProvider>
    </NuqsAdapter>
  </BrowserRouter>,
);
