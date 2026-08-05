import { useCallback, useState } from "react";
import { STORAGE_KEYS } from "@/lib";
import { usePersistedState } from "./use-persisted-state";

type UseOverlaysResult = {
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  helpOpen: boolean;
  setHelpOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  aboutOpen: boolean;
  setAboutOpen: (v: boolean) => void;
  welcomeOpen: boolean;
  dismissWelcome: () => void;
  showWelcome: () => void;
  showHelp: () => void;
  showAbout: () => void;
};

export function useOverlays(): UseOverlaysResult {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [welcomed, setWelcomed] = usePersistedState<boolean>(STORAGE_KEYS.welcomed, false);
  const [welcomeOpen, setWelcomeOpen] = useState(!welcomed);

  const dismissWelcome = useCallback(() => {
    setWelcomeOpen(false);
    setWelcomed(true);
  }, [setWelcomed]);

  const showWelcome = useCallback(() => setWelcomeOpen(true), []);
  const showHelp = useCallback(() => setHelpOpen(true), []);
  const showAbout = useCallback(() => setAboutOpen(true), []);

  return {
    paletteOpen,
    setPaletteOpen,
    helpOpen,
    setHelpOpen,
    aboutOpen,
    setAboutOpen,
    welcomeOpen,
    dismissWelcome,
    showWelcome,
    showHelp,
    showAbout,
  };
}
