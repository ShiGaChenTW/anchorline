import { useCallback, useState } from "react";
import type { LoadError } from "./use-file-session";

type UseNotificationsResult = {
  loadError: LoadError | null;
  setLoadError: (v: LoadError | null) => void;
  dismissLoadError: () => void;
  copyPulse: boolean;
  copyToast: string | null;
  dismissCopyToast: () => void;
  saveAsToast: string | null;
  dismissSaveAsToast: () => void;
  /** Triggers the "saved to {filename}" toast with auto-clear after 2.4s. */
  showSaveAsToast: (message: string) => void;
  /** Copies text to clipboard + fires both the breadcrumb pulse and ambient toast. */
  copyMarkdown: (text: string, message?: string) => Promise<void>;
};

export function useNotifications(): UseNotificationsResult {
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [copyPulse, setCopyPulse] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [saveAsToast, setSaveAsToast] = useState<string | null>(null);

  const dismissLoadError = useCallback(() => setLoadError(null), []);
  const dismissCopyToast = useCallback(() => setCopyToast(null), []);
  const dismissSaveAsToast = useCallback(() => setSaveAsToast(null), []);

  const showSaveAsToast = useCallback((message: string) => {
    setSaveAsToast(message);
    window.setTimeout(() => setSaveAsToast(null), 2400);
  }, []);

  const copyMarkdown = useCallback(async (text: string, message = "copied to clipboard · paste anywhere") => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyPulse(true);
      setCopyToast(message);
      window.setTimeout(() => setCopyPulse(false), 1200);
      window.setTimeout(() => setCopyToast(null), 2200);
    } catch (err) {
      console.error("marka.md: copy failed", err);
    }
  }, []);

  return {
    loadError,
    setLoadError,
    dismissLoadError,
    copyPulse,
    copyToast,
    dismissCopyToast,
    saveAsToast,
    dismissSaveAsToast,
    showSaveAsToast,
    copyMarkdown,
  };
}
