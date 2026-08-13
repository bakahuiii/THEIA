import { Maximize2, Minimize2, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge, isDesktop } from "../bridge";
import theiaMark from "../assets/theia-mark.png";

/**
 * The center remains draggable while the custom controls opt out of dragging,
 * so the desktop window retains familiar native behavior without WCO chrome.
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void bridge.windowIsMaximized?.()
      .then(setMaximized)
      .catch(() => undefined);
  }, []);

  if (!isDesktop) return null;

  const toggleMaximize = async () => {
    await bridge.windowMaximize?.();
    setMaximized((value) => !value);
  };

  return (
    <header
      className="titlebar"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="titlebar-brand">
        <img src={theiaMark} alt="" className="titlebar-icon" />
        <span className="titlebar-title">THEIA</span>
      </div>
      <div
        className="titlebar-window-actions"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          className="window-control"
          type="button"
          onClick={() => void bridge.windowMinimize?.()}
          aria-label="最小化窗口"
          title="最小化"
        >
          <Minimize2 size={14} />
        </button>
        <button
          className="window-control"
          type="button"
          onClick={() => void toggleMaximize()}
          aria-label={maximized ? "还原窗口" : "最大化窗口"}
          title={maximized ? "还原" : "最大化"}
        >
          {maximized ? <Square size={12} /> : <Maximize2 size={14} />}
        </button>
        <button
          className="window-control close"
          type="button"
          onClick={() => void bridge.windowClose?.()}
          aria-label="关闭窗口"
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
