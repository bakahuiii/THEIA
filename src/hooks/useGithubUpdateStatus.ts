import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import type { GithubUpdateStatus } from "../types";

export function defaultGithubUpdateStatus(currentVersion = "web"): GithubUpdateStatus {
  return {
    supported: false,
    state: "unsupported",
    currentVersion: currentVersion || "web",
    availableVersion: null,
    releaseName: null,
    releaseDate: null,
    lastCheckedAt: null,
    progress: null,
    error: null,
  };
}

export function useGithubUpdateStatus(currentVersion = "web") {
  const [status, setStatus] = useState<GithubUpdateStatus>(() =>
    defaultGithubUpdateStatus(currentVersion),
  );

  useEffect(() => {
    let active = true;
    const sync = async () => {
      try {
        const next = await bridge.getUpdateStatus();
        if (active) setStatus(next);
      } catch {
        if (active) setStatus(defaultGithubUpdateStatus(currentVersion));
      }
    };
    void sync();
    const unsubscribe = bridge.onUpdateStatus?.((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [currentVersion]);

  return status;
}
