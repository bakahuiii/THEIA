import {
  LocateFixed,
  Map as MapIcon,
  Minus,
  Plus,
  Satellite,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import campusMap from "../assets/theia-changping-campus-map.jpg";
import satelliteMap from "../assets/theia-changping-campus-satellite-mercator.webp";

type MapLayer = "campus" | "satellite";
type MapPosition = { x: number; y: number };
type SavedMapView = { layer: MapLayer; zoom: number; position: MapPosition };

type DragState = {
  lastX: number;
  lastY: number;
  lastAt: number;
};

const mapSources: Record<
  MapLayer,
  { alt: string; width: number; height: number }
> = {
  campus: { alt: "北京化工大学昌平校区地图", width: 6874, height: 10063 },
  satellite: { alt: "北京化工大学昌平校区卫星图", width: 6874, height: 10063 },
};

const MAP_VIEW_STORAGE_KEY = "theia-campus-map-view-v1";
const defaultMapView: SavedMapView = {
  layer: "campus",
  zoom: 1,
  position: { x: 0, y: 0 },
};

function readSavedMapView(): SavedMapView {
  try {
    const raw = localStorage.getItem(MAP_VIEW_STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<SavedMapView>) : null;
    const position = saved?.position;
    return {
      layer: saved?.layer === "satellite" ? "satellite" : "campus",
      zoom:
        typeof saved?.zoom === "number" && Number.isFinite(saved.zoom)
          ? Math.max(1, Math.min(20, saved.zoom))
          : 1,
      position:
        position &&
        typeof position.x === "number" &&
        Number.isFinite(position.x) &&
        typeof position.y === "number" &&
        Number.isFinite(position.y)
          ? position
          : { x: 0, y: 0 },
    };
  } catch {
    return defaultMapView;
  }
}

export function CampusMapView() {
  const [initialView] = useState(readSavedMapView);
  const [layer, setLayer] = useState<MapLayer>(initialView.layer);
  const [zoom, setZoom] = useState(initialView.zoom);
  const [position, setPosition] = useState<MapPosition>(initialView.position);
  const [maxZoom, setMaxZoom] = useState(6);
  const [dragging, setDragging] = useState(false);
  const [coasting, setCoasting] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const mapImageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const positionRef = useRef<MapPosition>(initialView.position);
  const zoomRef = useRef(initialView.zoom);
  const velocityRef = useRef<MapPosition>({ x: 0, y: 0 });
  const inertiaFrameRef = useRef<number | null>(null);
  const zoomByRef = useRef<
    (factor: number, event?: { clientX: number; clientY: number }) => void
  >(() => {});

  const applyPosition = useCallback((next: MapPosition) => {
    positionRef.current = next;
    setPosition(next);
  }, []);

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
    velocityRef.current = { x: 0, y: 0 };
    setCoasting(false);
  }, []);

  const syncMaxZoom = useCallback(() => {
    const sheet = sheetRef.current;
    const source = mapSources[layer];
    if (!sheet?.offsetWidth) return;
    const nextMaxZoom = Math.max(
      1,
      Math.floor(
        Math.min(
          source.width / sheet.offsetWidth,
          source.height / sheet.offsetHeight,
        ) * 100,
      ) / 100,
    );
    setMaxZoom(nextMaxZoom);
    if (zoomRef.current > nextMaxZoom) {
      zoomRef.current = nextMaxZoom;
      setZoom(nextMaxZoom);
    }
  }, [layer]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const satellite = new Image();
    satellite.src = satelliteMap;
    const zoomWithWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zoomByRef.current(event.deltaY < 0 ? 1.18 : 1 / 1.18, event);
    };
    stage.addEventListener("wheel", zoomWithWheel, { passive: false });
    syncMaxZoom();
    const observer = new ResizeObserver(syncMaxZoom);
    observer.observe(stage);
    return () => {
      stage.removeEventListener("wheel", zoomWithWheel);
      observer.disconnect();
    };
  }, [syncMaxZoom]);

  useEffect(
    () => () => {
      if (inertiaFrameRef.current !== null)
        cancelAnimationFrame(inertiaFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(
          MAP_VIEW_STORAGE_KEY,
          JSON.stringify({ layer, zoom, position }),
        );
      } catch {
        // The map remains usable when local preferences cannot be saved.
      }
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [layer, position, zoom]);

  const startInertia = useCallback(() => {
    if (Math.hypot(velocityRef.current.x, velocityRef.current.y) < 0.2) {
      velocityRef.current = { x: 0, y: 0 };
      return;
    }
    setCoasting(true);
    let previousAt = performance.now();
    const coast = (now: number) => {
      const frameScale = Math.min(2, (now - previousAt) / 16.667 || 1);
      previousAt = now;
      const velocity = velocityRef.current;
      const friction = Math.pow(0.942, frameScale);
      velocity.x *= friction;
      velocity.y *= friction;

      if (Math.hypot(velocity.x, velocity.y) < 0.055) {
        velocityRef.current = { x: 0, y: 0 };
        inertiaFrameRef.current = null;
        setCoasting(false);
        return;
      }

      applyPosition({
        x: positionRef.current.x + velocity.x * frameScale,
        y: positionRef.current.y + velocity.y * frameScale,
      });
      inertiaFrameRef.current = requestAnimationFrame(coast);
    };
    inertiaFrameRef.current = requestAnimationFrame(coast);
  }, [applyPosition]);

  const updateZoom = (nextZoom: number, clientX?: number, clientY?: number) => {
    stopInertia();
    const next = Math.min(maxZoom, Math.max(1, nextZoom));
    const currentZoom = zoomRef.current;
    if (next === currentZoom) return;
    const stage = stageRef.current;
    if (stage && clientX !== undefined && clientY !== undefined) {
      const rect = stage.getBoundingClientRect();
      const cursor = {
        x: clientX - rect.left - rect.width / 2,
        y: clientY - rect.top - rect.height / 2,
      };
      applyPosition({
        x: cursor.x - ((cursor.x - positionRef.current.x) / currentZoom) * next,
        y: cursor.y - ((cursor.y - positionRef.current.y) / currentZoom) * next,
      });
    }
    zoomRef.current = next;
    setZoom(next);
  };
  const zoomBy = (
    factor: number,
    event?: { clientX: number; clientY: number },
  ) => updateZoom(zoomRef.current * factor, event?.clientX, event?.clientY);
  zoomByRef.current = zoomBy;
  const resetMap = () => {
    stopInertia();
    zoomRef.current = 1;
    setZoom(1);
    applyPosition({ x: 0, y: 0 });
  };
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, a")) return;
    stopInertia();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      lastX: event.clientX,
      lastY: event.clientY,
      lastAt: performance.now(),
    };
    setDragging(true);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const now = performance.now();
    const elapsed = Math.max(1, now - drag.lastAt);
    const delta = {
      x: event.clientX - drag.lastX,
      y: event.clientY - drag.lastY,
    };
    applyPosition({
      x: positionRef.current.x + delta.x,
      y: positionRef.current.y + delta.y,
    });
    const frameScale = Math.min(2, 16.667 / elapsed);
    const nextVelocity = {
      x: velocityRef.current.x * 0.3 + delta.x * frameScale * 0.7,
      y: velocityRef.current.y * 0.3 + delta.y * frameScale * 0.7,
    };
    const magnitude = Math.hypot(nextVelocity.x, nextVelocity.y);
    velocityRef.current =
      magnitude > 18
        ? {
            x: (nextVelocity.x / magnitude) * 18,
            y: (nextVelocity.y / magnitude) * 18,
          }
        : nextVelocity;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastAt = now;
  };
  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      dragRef.current &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    )
      event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDragging(false);
    startInertia();
  };

  return (
    <section className="campus-map-panel">
      <div
        ref={stageRef}
        className={[
          "map-stage",
          dragging ? "is-dragging" : "",
          coasting ? "is-coasting" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        tabIndex={0}
        aria-label="昌平校区互动地图"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onDoubleClick={(event) => zoomBy(1.7, event)}
        onKeyDown={(event) => {
          if (event.key === "+" || event.key === "=") zoomBy(1.35);
          if (event.key === "-") zoomBy(1 / 1.35);
          if (event.key === "0") resetMap();
        }}
      >
        <div
          ref={sheetRef}
          className="map-sheet"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
          }}
        >
          <img
            ref={mapImageRef}
            className="map-base-image"
            src={campusMap}
            alt={layer === "campus" ? mapSources.campus.alt : ""}
            draggable={false}
            onLoad={syncMaxZoom}
          />
          {layer === "satellite" && (
            <img
              className="map-satellite-overlay"
              src={satelliteMap}
              alt={mapSources.satellite.alt}
              draggable={false}
            />
          )}
        </div>
        <div className="map-control-stack">
          <div className="map-zoom-hud" aria-live="polite">
            <strong>{Math.round(zoom * 100)}%</strong>
            <span>{dragging ? "拖动中" : "滚轮缩放 · 拖动地图"}</span>
          </div>
          <div className="map-layer-controls" aria-label="底图切换">
            <button
              className={`icon-button map-tool-button ${layer === "campus" ? "active" : ""}`}
              data-tooltip="校园总图"
              aria-label="切换到校园总图"
              aria-pressed={layer === "campus"}
              onClick={() => setLayer("campus")}
            >
              <MapIcon size={17} />
            </button>
            <button
              className={`icon-button map-tool-button ${layer === "satellite" ? "active" : ""}`}
              data-tooltip="卫星底图"
              aria-label="切换到卫星底图"
              aria-pressed={layer === "satellite"}
              onClick={() => setLayer("satellite")}
            >
              <Satellite size={17} />
            </button>
          </div>
          <div className="map-zoom-controls" aria-label="地图缩放控制">
            <button
              className="icon-button map-tool-button"
              data-tooltip="放大"
              aria-label="放大地图"
              onClick={() => zoomBy(1.35)}
            >
              <Plus size={18} />
            </button>
            <button
              className="icon-button map-tool-button"
              data-tooltip="缩小"
              aria-label="缩小地图"
              onClick={() => zoomBy(1 / 1.35)}
            >
              <Minus size={18} />
            </button>
            <button
              className="icon-button map-tool-button"
              data-tooltip="查看全图"
              aria-label="查看全图"
              onClick={resetMap}
            >
              <LocateFixed size={17} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
