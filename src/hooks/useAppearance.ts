import { useCallback, useEffect, useMemo, useState } from "react";
import { bridge, isDesktop } from "../bridge";

const STORAGE_KEY = "theia-appearance-v1";
const APPEARANCE_EVENT = "theia:appearance-change";
const SYSTEM_QUERY = "(prefers-color-scheme: dark)";

export type AppearanceMode = "light" | "dark" | "system";
export type ResolvedAppearanceMode = Exclude<AppearanceMode, "system">;

function normalizeMode(value: unknown): AppearanceMode {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

function readMode(): AppearanceMode {
  try {
    return normalizeMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "system";
  }
}

function readSystemDark() {
  return window.matchMedia?.(SYSTEM_QUERY).matches ?? false;
}

function resolveMode(
  mode: AppearanceMode,
  systemDark: boolean,
): ResolvedAppearanceMode {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

function applyMode(mode: ResolvedAppearanceMode, preference: AppearanceMode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
  document.documentElement.dataset.appearance = preference;
}

function persistMode(mode: AppearanceMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Appearance remains usable when persistent storage is unavailable.
  }
}

export function useAppearance() {
  const [mode, setModeState] = useState<AppearanceMode>(readMode);
  const [systemDark, setSystemDark] = useState(readSystemDark);
  const [zoom, setZoomState] = useState(100);
  const resolvedMode = useMemo(
    () => resolveMode(mode, systemDark),
    [mode, systemDark],
  );

  useEffect(() => {
    applyMode(resolvedMode, mode);
  }, [mode, resolvedMode]);

  useEffect(() => {
    const media = window.matchMedia?.(SYSTEM_QUERY);
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onAppearanceChange = (event: Event) => {
      const nextMode = normalizeMode((event as CustomEvent<unknown>).detail);
      setModeState(nextMode);
    };
    window.addEventListener(APPEARANCE_EVENT, onAppearanceChange);
    return () => window.removeEventListener(APPEARANCE_EVENT, onAppearanceChange);
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    bridge.zoomGet?.()
      .then((result) => result && setZoomState(result.percent))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    return bridge.onAppearanceMode?.((externalMode) => {
      const nextMode = normalizeMode(externalMode);
      persistMode(nextMode);
      setModeState(nextMode);
      window.dispatchEvent(
        new CustomEvent(APPEARANCE_EVENT, { detail: nextMode }),
      );
    });
  }, []);

  const setMode = useCallback((nextMode: AppearanceMode) => {
    persistMode(nextMode);
    setModeState(nextMode);
    window.dispatchEvent(
      new CustomEvent(APPEARANCE_EVENT, { detail: nextMode }),
    );
    if (isDesktop) bridge.setAppearanceMode?.(nextMode);
  }, []);

  const setZoom = useCallback((percent: number) => {
    setZoomState(percent);
    if (isDesktop) bridge.zoomSet?.(percent);
  }, []);

  return {
    mode,
    resolvedMode,
    setMode,
    zoom,
    setZoom,
  };
}
