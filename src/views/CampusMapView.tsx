import {
  Building2,
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
import firstFloor1 from "../assets/indoor/first/aligned/1A.png";
import firstFloor2 from "../assets/indoor/first/aligned/2A.png";
import firstFloor3 from "../assets/indoor/first/aligned/3A.png";
import firstFloor4 from "../assets/indoor/first/aligned/4A.png";
import firstFloor5 from "../assets/indoor/first/aligned/5A.png";
import secondFloor1 from "../assets/indoor/second/floor-1.png";
import secondFloor2 from "../assets/indoor/second/floor-2.png";
import secondFloor3 from "../assets/indoor/second/floor-3.png";
import secondFloor4 from "../assets/indoor/second/floor-4.png";
import secondFloor5 from "../assets/indoor/second/floor-5.png";

type BuildingId = "campus" | "first" | "second";
type MapLayer = "campus" | "satellite";
type MapPosition = { x: number; y: number };
type SheetSize = { width: number; height: number };
type MapSource = {
  alt: string;
  title: string;
  src: string;
  width: number;
  height: number;
};
type SavedMapView = {
  building: BuildingId;
  floor: number;
  layer: MapLayer;
  zoom: number;
  position: MapPosition;
};

type DragState = {
  lastX: number;
  lastY: number;
  lastAt: number;
};

const campusSource: MapSource = {
  alt: "北京化工大学昌平校区地图",
  title: "昌平校区",
  src: campusMap,
  width: 6874,
  height: 10063,
};

const satelliteSource: MapSource = {
  alt: "北京化工大学昌平校区卫星图",
  title: "昌平校区卫星图",
  src: satelliteMap,
  width: 6874,
  height: 10063,
};

const firstFloors: MapSource[] = [
  ["1 层", firstFloor1, 4918, 2516],
  ["2 层", firstFloor2, 4820, 2531],
  ["3 层", firstFloor3, 4813, 2527],
  ["4 层", firstFloor4, 4792, 2473],
  ["5 层", firstFloor5, 4835, 2509],
].map(([label, src, width, height]) => ({
  alt: `第一教学楼 ${label}室内平面图`,
  title: `第一教学楼 · ${label}`,
  src: src as string,
  width: width as number,
  height: height as number,
}));

const secondFloors: MapSource[] = [
  ["1 层", secondFloor1, 4368, 3433],
  ["2 层", secondFloor2, 4368, 3433],
  ["3 层", secondFloor3, 4368, 3433],
  ["4 层", secondFloor4, 4368, 3433],
  ["5 层", secondFloor5, 4368, 3433],
].map(([label, src, width, height]) => ({
  alt: `第二教学楼 ${label}室内平面图`,
  title: `第二教学楼 · ${label}`,
  src: src as string,
  width: width as number,
  height: height as number,
}));

const MAP_VIEW_STORAGE_KEY = "theia-campus-map-view-v2";
const defaultMapView: SavedMapView = {
  building: "campus",
  floor: 0,
  layer: "campus",
  zoom: 1,
  position: { x: 0, y: 0 },
};

function isBuilding(value: unknown): value is BuildingId {
  return value === "campus" || value === "first" || value === "second";
}

function readSavedMapView(): SavedMapView {
  try {
    const raw = localStorage.getItem(MAP_VIEW_STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<SavedMapView>) : null;
    const position = saved?.position;
    return {
      building: isBuilding(saved?.building) ? saved.building : "campus",
      floor:
        typeof saved?.floor === "number" && Number.isFinite(saved.floor)
          ? Math.max(0, Math.min(4, Math.floor(saved.floor)))
          : 0,
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

function getMapSource(building: BuildingId, floor: number, layer: MapLayer): MapSource {
  if (building === "campus") return layer === "satellite" ? satelliteSource : campusSource;
  const floors = building === "first" ? firstFloors : secondFloors;
  return floors[floor] ?? floors[0];
}

export function CampusMapView() {
  const [initialView] = useState(readSavedMapView);
  const [building, setBuilding] = useState<BuildingId>(initialView.building);
  const [floor, setFloor] = useState(initialView.floor);
  const [layer, setLayer] = useState<MapLayer>(
    initialView.building === "campus" ? initialView.layer : "campus",
  );
  const [zoom, setZoom] = useState(initialView.zoom);
  const [position, setPosition] = useState<MapPosition>(initialView.position);
  const [sheetSize, setSheetSize] = useState<SheetSize>({ width: 0, height: 0 });
  const [maxZoom, setMaxZoom] = useState(6);
  const [dragging, setDragging] = useState(false);
  const [coasting, setCoasting] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const sourceSelectionRef = useRef({
    building: initialView.building,
    floor: initialView.floor,
  });
  const positionRef = useRef<MapPosition>(initialView.position);
  const zoomRef = useRef(initialView.zoom);
  const velocityRef = useRef<MapPosition>({ x: 0, y: 0 });
  const inertiaFrameRef = useRef<number | null>(null);
  const zoomByRef = useRef<
    (factor: number, event?: { clientX: number; clientY: number }) => void
  >(() => {});
  const source = getMapSource(building, floor, layer);
  const baseSource = getMapSource(building, floor, "campus");

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

  const resetViewForSource = useCallback(() => {
    stopInertia();
    zoomRef.current = 1;
    positionRef.current = { x: 0, y: 0 };
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, [stopInertia]);

  const syncMaxZoom = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const fitScale = Math.min(rect.width / baseSource.width, rect.height / baseSource.height);
    const nextSize = {
      width: Math.max(1, Math.round(baseSource.width * fitScale)),
      height: Math.max(1, Math.round(baseSource.height * fitScale)),
    };
    setSheetSize((current) =>
      current.width === nextSize.width && current.height === nextSize.height
        ? current
        : nextSize,
    );
    const nextMaxZoom = Math.max(1, Math.floor((1 / fitScale) * 100) / 100);
    setMaxZoom(nextMaxZoom);
    if (zoomRef.current > nextMaxZoom) {
      zoomRef.current = nextMaxZoom;
      setZoom(nextMaxZoom);
    }
  }, [baseSource.height, baseSource.width]);

  useEffect(() => {
    const previous = sourceSelectionRef.current;
    if (previous.building === building && previous.floor === floor) return;
    sourceSelectionRef.current = { building, floor };
    resetViewForSource();
  }, [building, floor, resetViewForSource]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
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
          JSON.stringify({ building, floor, layer, zoom, position }),
        );
      } catch {
        // The map remains usable when local preferences cannot be saved.
      }
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [building, floor, layer, position, zoom]);

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

  const selectBuilding = (next: BuildingId) => {
    if (next === building) return;
    setBuilding(next);
    setFloor(0);
    setLayer("campus");
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
        aria-label={`${source.title}互动地图`}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onDoubleClick={(event) => zoomBy(1.7, event)}
        onKeyDown={(event) => {
          if (event.key === "+" || event.key === "=") zoomBy(1.35);
          if (event.key === "-") zoomBy(1 / 1.35);
          if (event.key === "0") resetViewForSource();
        }}
      >
        <div
          className="map-sheet"
          style={{
            ...(sheetSize.width
              ? { width: `${sheetSize.width}px`, height: `${sheetSize.height}px` }
              : {}),
            aspectRatio: `${baseSource.width} / ${baseSource.height}`,
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
          }}
        >
          <img
            className="map-base-image"
            src={baseSource.src}
            alt={layer === "campus" ? baseSource.alt : ""}
            draggable={false}
            onLoad={syncMaxZoom}
          />
          {building === "campus" && layer === "satellite" && (
            <img
              className="map-satellite-overlay"
              src={satelliteSource.src}
              alt={satelliteSource.alt}
              draggable={false}
            />
          )}
        </div>
        <div className="map-control-stack">
          <div className="map-zoom-hud" aria-live="polite">
            <strong>{Math.round(zoom * 100)}%</strong>
            <span>{dragging ? "拖动中" : "滚轮缩放 · 拖动地图"}</span>
          </div>
          <div className="map-building-controls" aria-label="地图范围">
            <button
              className={`map-building-button ${building === "campus" ? "active" : ""}`}
              aria-label="查看校园总图"
              aria-pressed={building === "campus"}
              onClick={() => selectBuilding("campus")}
            >
              <MapIcon size={15} />
              <span>校园</span>
            </button>
            <button
              className={`map-building-button ${building === "first" ? "active" : ""}`}
              aria-label="查看第一教学楼"
              aria-pressed={building === "first"}
              onClick={() => selectBuilding("first")}
            >
              <Building2 size={15} />
              <span>一教</span>
            </button>
            <button
              className={`map-building-button ${building === "second" ? "active" : ""}`}
              aria-label="查看第二教学楼"
              aria-pressed={building === "second"}
              onClick={() => selectBuilding("second")}
            >
              <Building2 size={15} />
              <span>二教</span>
            </button>
          </div>
          {building !== "campus" && (
            <div className="map-floor-controls" aria-label="楼层切换">
              {[0, 1, 2, 3, 4].map((value) => (
                <button
                  key={value}
                  className={floor === value ? "active" : ""}
                  aria-label={`查看${value + 1}层`}
                  aria-pressed={floor === value}
                  onClick={() => setFloor(value)}
                >
                  {value + 1}
                </button>
              ))}
            </div>
          )}
          {building === "campus" && (
            <div className="map-layer-controls" aria-label="校园底图切换">
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
          )}
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
              onClick={resetViewForSource}
            >
              <LocateFixed size={17} />
            </button>
          </div>
        </div>
        <div className="map-positioning-status" role="status">
          <LocateFixed size={14} aria-hidden="true" />
          <span>定位接口预留</span>
          <small>Windows 端关闭</small>
        </div>
      </div>
    </section>
  );
}
