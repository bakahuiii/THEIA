import {
  Building2,
  LocateFixed,
  Map as MapIcon,
  Minus,
  Plus,
  Satellite,
  Crosshair,
  Flag,
  Navigation,
  Check,
  X,
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
import gridData from "../assets/campus/grid.json";
import {
  type BuildingMark,
  BUILDING_DEFS,
  buildingDefByKey,
  readBuildingMarks,
  writeBuildingMarks,
} from "../map/campus-buildings";
import {
  type CampusGrid,
  type GridPoint,
  decodeWalkable,
  findPath,
  smoothPath,
  labelComponents,
  pixelToGrid,
  gridToPixel,
  pathPixelLength,
} from "../map/campus-pathfinding";
import {
  listenCampusNavigation,
  type CampusNavigationRequest,
} from "../map/navigation-bus";

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

type DragState = { lastX: number; lastY: number; lastAt: number };

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
      floor: typeof saved?.floor === "number" && Number.isFinite(saved.floor) ? Math.max(0, Math.min(4, Math.floor(saved.floor))) : 0,
      layer: saved?.layer === "satellite" ? "satellite" : "campus",
      zoom: typeof saved?.zoom === "number" && Number.isFinite(saved.zoom) ? Math.max(1, Math.min(20, saved.zoom)) : 1,
      position: position && typeof position.x === "number" && Number.isFinite(position.x) && typeof position.y === "number" && Number.isFinite(position.y) ? position : { x: 0, y: 0 },
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

// ---- Campus map -------------------------------------------------------------

export function CampusMapView() {
  const [initialView] = useState(readSavedMapView);
  const [building, setBuilding] = useState<BuildingId>(initialView.building);
  const [floor, setFloor] = useState(initialView.floor);
  const [layer, setLayer] = useState<MapLayer>(initialView.building === "campus" ? initialView.layer : "campus");
  const [zoom, setZoom] = useState(initialView.zoom);
  const [position, setPosition] = useState<MapPosition>(initialView.position);
  const [sheetSize, setSheetSize] = useState<SheetSize>({ width: 0, height: 0 });
  const [maxZoom, setMaxZoom] = useState(6);
  const [dragging, setDragging] = useState(false);
  const [coasting, setCoasting] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragMovedRef = useRef(0);
  const sourceSelectionRef = useRef({ building: initialView.building, floor: initialView.floor });
  const positionRef = useRef<MapPosition>(initialView.position);
  const zoomRef = useRef(initialView.zoom);
  const velocityRef = useRef<MapPosition>({ x: 0, y: 0 });
  const inertiaFrameRef = useRef<number | null>(null);
  const zoomByRef = useRef<(factor: number, event?: { clientX: number; clientY: number }) => void>(() => {});
  const source = getMapSource(building, floor, layer);
  const baseSource = getMapSource(building, floor, "campus");

  // ---- Navigation state -----------------------------------------------------
  const [marks, setMarks] = useState<BuildingMark[]>(() => readBuildingMarks());
  const [markingMode, setMarkingMode] = useState(false);
  const [markingCandidate, setMarkingCandidate] = useState<{ x: number; y: number; buildingKey: string } | null>(null);
  const [navFrom, setNavFrom] = useState<string | null>(null);
  const [navTo, setNavTo] = useState<string | null>(null);
  const [route, setRoute] = useState<GridPoint[] | null>(null);
  const [routeDistance, setRouteDistance] = useState<string | null>(null);
  const [pendingNav, setPendingNav] = useState<CampusNavigationRequest | null>(null);
  const [showNavSelector, setShowNavSelector] = useState(false);
  const [navNotice, setNavNotice] = useState<string | null>(null);

  // Grid (lazy load once)
  const gridRef = useRef<CampusGrid | null>(null);
  const cellsRef = useRef<Uint8Array | null>(null);
  const componentsRef = useRef<Int32Array | null>(null);
  const largestIdRef = useRef(-1);
  if (!gridRef.current) {
    gridRef.current = gridData as unknown as CampusGrid;
    cellsRef.current = decodeWalkable(gridRef.current);
    const labeled = labelComponents(gridRef.current, cellsRef.current);
    componentsRef.current = labeled.components;
    largestIdRef.current = labeled.largestId;
  }

  // Listen for navigation requests from schedule view.
  useEffect(() => {
    return listenCampusNavigation((req) => {
      setPendingNav(req);
    });
  }, []);

  // When a navigation request arrives: switch to campus view, find target.
  useEffect(() => {
    if (!pendingNav) return;
    setBuilding("campus");
    // Check if the target building is marked.
    const existing = marks.find((m) => m.key === pendingNav.buildingKey);
    if (existing) {
      setNavTo(pendingNav.buildingKey);
      setNavFrom(null);
      setRoute(null);
      // Center and zoom on the target after the layout has settled.
      const frame = requestAnimationFrame(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const fitScale = Math.min(rect.width / baseSource.width, rect.height / baseSource.height);
        const sheetW = baseSource.width * fitScale;
        const sheetH = baseSource.height * fitScale;
        const normX = existing.x / baseSource.width;
        const normY = existing.y / baseSource.height;
        const targetZoom = 2.6;
        const offsetX = (normX - 0.5) * sheetW;
        const offsetY = (normY - 0.5) * sheetH;
        zoomRef.current = targetZoom;
        setZoom(targetZoom);
        positionRef.current = { x: -offsetX * targetZoom, y: -offsetY * targetZoom };
        setPosition({ x: -offsetX * targetZoom, y: -offsetY * targetZoom });
      });
      return () => cancelAnimationFrame(frame);
    } else {
      // No mark yet — user must mark it first.
      setNavTo(pendingNav.buildingKey);
      setNavFrom(null);
      setRoute(null);
      setNavNotice(`「${buildingDefByKey(pendingNav.buildingKey)?.name ?? pendingNav.buildingKey}」尚未标注，请开启标注模式并在地图上点击它的位置`);
      setShowNavSelector(false);
    }
    setPendingNav(null);
  }, [pendingNav, marks, baseSource.width, baseSource.height]);

  // Recompute route when navFrom/navTo change.
  useEffect(() => {
    if (!navTo || !gridRef.current || !cellsRef.current) {
      setRoute(null);
      setRouteDistance(null);
      return;
    }
    const grid = gridRef.current;
    const cells = cellsRef.current;
    const marksList = readBuildingMarks();
    const toMark = marksList.find((m) => m.key === navTo);
    const fromMark = navFrom ? marksList.find((m) => m.key === navFrom) : null;
    if (!toMark) {
      setRoute(null);
      setRouteDistance(null);
      return;
    }
    const toG = pixelToGrid(grid, toMark.x, toMark.y);
    const fromG = fromMark ? pixelToGrid(grid, fromMark.x, fromMark.y) : null;
    // If no start point but we have a destination, just show the target marker.
    if (!fromG) {
      setRoute(null);
      setRouteDistance(null);
      return;
    }
    // Pathfind.
    const path = findPath(grid, cells, fromG, toG, componentsRef.current!, largestIdRef.current);
    if (path) {
      const smoothed = smoothPath(grid, cells, path);
      setRoute(smoothed);
      // Campus map scale: source height 10063 px ≈ 900 m, so ~0.09 m/px.
      const meters = pathPixelLength(grid, smoothed) * 0.09;
      setRouteDistance(meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`);
    } else {
      setRoute(null);
      setRouteDistance(null);
    }
  }, [navFrom, navTo, marks]);

  // ---- Map interaction ------------------------------------------------------
  const applyPosition = useCallback((next: MapPosition) => {
    positionRef.current = next;
    setPosition(next);
  }, []);

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) { cancelAnimationFrame(inertiaFrameRef.current); inertiaFrameRef.current = null; }
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
    const nextSize = { width: Math.max(1, Math.round(baseSource.width * fitScale)), height: Math.max(1, Math.round(baseSource.height * fitScale)) };
    setSheetSize((current) => (current.width === nextSize.width && current.height === nextSize.height ? current : nextSize));
    const nextMaxZoom = Math.max(1, Math.floor((1 / fitScale) * 100) / 100);
    setMaxZoom(nextMaxZoom);
    if (zoomRef.current > nextMaxZoom) { zoomRef.current = nextMaxZoom; setZoom(nextMaxZoom); }
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
    const zoomWithWheel = (event: WheelEvent) => { event.preventDefault(); event.stopPropagation(); zoomByRef.current(event.deltaY < 0 ? 1.18 : 1 / 1.18, event); };
    stage.addEventListener("wheel", zoomWithWheel, { passive: false });
    syncMaxZoom();
    const observer = new ResizeObserver(syncMaxZoom);
    observer.observe(stage);
    return () => { stage.removeEventListener("wheel", zoomWithWheel); observer.disconnect(); };
  }, [syncMaxZoom]);

  useEffect(() => () => { if (inertiaFrameRef.current !== null) cancelAnimationFrame(inertiaFrameRef.current); }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try { localStorage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify({ building, floor, layer, zoom, position })); } catch { /* ignore */ }
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [building, floor, layer, position, zoom]);

  const startInertia = useCallback(() => {
    if (Math.hypot(velocityRef.current.x, velocityRef.current.y) < 0.2) { velocityRef.current = { x: 0, y: 0 }; return; }
    setCoasting(true);
    let previousAt = performance.now();
    const coast = (now: number) => {
      const frameScale = Math.min(2, (now - previousAt) / 16.667 || 1);
      previousAt = now;
      const velocity = velocityRef.current;
      const friction = Math.pow(0.942, frameScale);
      velocity.x *= friction;
      velocity.y *= friction;
      if (Math.hypot(velocity.x, velocity.y) < 0.055) { velocityRef.current = { x: 0, y: 0 }; inertiaFrameRef.current = null; setCoasting(false); return; }
      applyPosition({ x: positionRef.current.x + velocity.x * frameScale, y: positionRef.current.y + velocity.y * frameScale });
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
      const cursor = { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
      applyPosition({ x: cursor.x - ((cursor.x - positionRef.current.x) / currentZoom) * next, y: cursor.y - ((cursor.y - positionRef.current.y) / currentZoom) * next });
    }
    zoomRef.current = next;
    setZoom(next);
  };

  const zoomBy = (factor: number, event?: { clientX: number; clientY: number }) => updateZoom(zoomRef.current * factor, event?.clientX, event?.clientY);
  zoomByRef.current = zoomBy;

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, a, .map-building-marker, .map-marker-overlay, .map-nav-selector")) return;
    stopInertia();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { lastX: event.clientX, lastY: event.clientY, lastAt: performance.now() };
    dragMovedRef.current = 0;
    setDragging(true);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const now = performance.now();
    const elapsed = Math.max(1, now - drag.lastAt);
    const delta = { x: event.clientX - drag.lastX, y: event.clientY - drag.lastY };
    dragMovedRef.current += Math.hypot(delta.x, delta.y);
    applyPosition({ x: positionRef.current.x + delta.x, y: positionRef.current.y + delta.y });
    const frameScale = Math.min(2, 16.667 / elapsed);
    const nextVelocity = { x: velocityRef.current.x * 0.3 + delta.x * frameScale * 0.7, y: velocityRef.current.y * 0.3 + delta.y * frameScale * 0.7 };
    const magnitude = Math.hypot(nextVelocity.x, nextVelocity.y);
    velocityRef.current = magnitude > 18 ? { x: (nextVelocity.x / magnitude) * 18, y: (nextVelocity.y / magnitude) * 18 } : nextVelocity;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastAt = now;
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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

  // ---- Marking interaction --------------------------------------------------
  const handleSheetClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Ignore clicks that ended a drag gesture.
      if (dragMovedRef.current > 5) return;
      if (!markingMode || !sheetRef.current) return;
      const sheet = sheetRef.current.getBoundingClientRect();
      const sx = event.clientX - sheet.left;
      const sy = event.clientY - sheet.top;
      // Map pixel = (client offset / sheet rendered size) * source dimension
      const px = Math.round((sx / sheet.width) * baseSource.width);
      const py = Math.round((sy / sheet.height) * baseSource.height);
      setMarkingCandidate({ x: px, y: py, buildingKey: "" });
    },
    [markingMode, baseSource.width, baseSource.height],
  );

  const confirmMark = (buildingKey: string) => {
    if (!markingCandidate) return;
    const existing = marks.filter((m) => m.key !== buildingKey);
    const newMark: BuildingMark = { key: buildingKey, x: markingCandidate.x, y: markingCandidate.y, markedAt: new Date().toISOString() };
    const updated = [...existing, newMark];
    setMarks(updated);
    writeBuildingMarks(updated);
    setMarkingCandidate(null);
    setMarkingMode(false);
    setNavNotice(null);
  };

  const cancelMark = () => {
    setMarkingCandidate(null);
  };

  const deleteMark = (key: string) => {
    const updated = marks.filter((m) => m.key !== key);
    setMarks(updated);
    writeBuildingMarks(updated);
    if (navFrom === key) setNavFrom(null);
    if (navTo === key) setNavTo(null);
  };

  const clearRoute = () => {
    setNavFrom(null);
    setNavTo(null);
    setRoute(null);
    setRouteDistance(null);
  };

  // ---- Render helpers -------------------------------------------------------
  const sheetStyle = sheetSize.width
    ? { width: `${sheetSize.width}px`, height: `${sheetSize.height}px` }
    : {};
  const transform = `translate(${position.x}px, ${position.y}px) scale(${zoom})`;

  // Convert map pixel coordinates to percentage within the sheet.
  const pct = (px: number, py: number) => {
    const sw = baseSource.width, sh = baseSource.height;
    return { left: `${(px / sw) * 100}%`, top: `${(py / sh) * 100}%` };
  };

  // Path polyline points as percentages.
  const routePathPct = route
    ? route.map((p) => {
        const px = gridToPixel(gridRef.current!, p);
        return `${(px.x / baseSource.width) * 100}% ${(px.y / baseSource.height) * 100}%`;
      }).join(", ")
    : null;

  return (
    <section className="campus-map-panel">
      {/* Navigation bar */}
      {building === "campus" && (
        <div className="map-nav-bar">
          {navTo && (
            <div className="map-nav-status">
              <Navigation size={14} />
              <span>
                {buildingDefByKey(navTo)?.label ?? navTo}
                {navFrom && routeDistance ? ` ← ${buildingDefByKey(navFrom)?.label ?? navFrom} · ${routeDistance}` : "（已选目标）"}
              </span>
              <button type="button" className="map-nav-clear" onClick={clearRoute} aria-label="清除导航">
                <X size={14} />
              </button>
            </div>
          )}
          {navNotice && (
            <div className="map-nav-notice" role="status">
              <span>{navNotice}</span>
              <button type="button" onClick={() => setNavNotice(null)} aria-label="关闭提示"><X size={14} /></button>
            </div>
          )}
        </div>
      )}

      <div
        ref={stageRef}
        className={["map-stage", dragging ? "is-dragging" : "", coasting ? "is-coasting" : "", markingMode ? "marking-active" : ""].filter(Boolean).join(" ")}
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
          ref={sheetRef}
          className="map-sheet"
          style={{
            ...sheetStyle,
            aspectRatio: `${baseSource.width} / ${baseSource.height}`,
            transform,
          }}
          onClick={handleSheetClick}
        >
          <img className="map-base-image" src={baseSource.src} alt={layer === "campus" ? baseSource.alt : ""} draggable={false} onLoad={syncMaxZoom} />
          {building === "campus" && layer === "satellite" && (
            <img className="map-satellite-overlay" src={satelliteSource.src} alt={satelliteSource.alt} draggable={false} />
          )}

          {/* Building markers (visible only on campus view) */}
          {building === "campus" && marks.map((mark) => {
            const def = buildingDefByKey(mark.key);
            const isActive = mark.key === navTo;
            const isStart = mark.key === navFrom;
            const pos = pct(mark.x, mark.y);
            return (
              <div
                key={mark.key}
                className={`map-building-marker${isActive ? " is-target" : ""}${isStart ? " is-start" : ""}`}
                style={{ left: pos.left, top: pos.top }}
                title={`${def?.name ?? mark.key} (${mark.x}, ${mark.y})`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (markingMode) return;
                  // Toggle: set as nav target
                  if (navTo === mark.key) {
                    setNavTo(null);
                    setRoute(null);
                  } else {
                    setNavTo(mark.key);
                    // If there's already a start, recompute route
                  }
                }}
              >
                <Flag size={16} />
                <span className="map-marker-label">{def?.label ?? mark.key}</span>
                {mark.key === navTo && <span className="map-marker-badge">终点</span>}
                {mark.key === navFrom && <span className="map-marker-badge">起点</span>}
              </div>
            );
          })}

          {/* Route path */}
          {routePathPct && (
            <svg className="map-route-overlay" viewBox={`0 0 ${baseSource.width} ${baseSource.height}`} preserveAspectRatio="none">
              <polyline
                className="map-route-line"
                points={routePathPct}
                fill="none"
                stroke="#5b9cf5"
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Start dot */}
              {route && route.length > 0 && (
                <circle
                  cx={`${(route[0].x + 0.5) / gridRef.current!.width * 100}%`}
                  cy={`${(route[0].y + 0.5) / gridRef.current!.height * 100}%`}
                  r={8}
                  fill="#22c55e"
                  stroke="#fff"
                  strokeWidth={3}
                />
              )}
              {/* End dot */}
              {route && route.length > 0 && (
                <circle
                  cx={`${(route[route.length - 1].x + 0.5) / gridRef.current!.width * 100}%`}
                  cy={`${(route[route.length - 1].y + 0.5) / gridRef.current!.height * 100}%`}
                  r={8}
                  fill="#ef4444"
                  stroke="#fff"
                  strokeWidth={3}
                />
              )}
            </svg>
          )}

          {/* Marking candidate (before confirmation) */}
          {markingCandidate && (
            <div className="map-marking-candidate" style={{ left: pct(markingCandidate.x, markingCandidate.y).left, top: pct(markingCandidate.x, markingCandidate.y).top }}>
              <Crosshair size={24} />
            </div>
          )}
        </div>

        {/* Marking overlay (building selector) */}
        {markingCandidate && (
          <div className="map-marker-overlay">
            <div className="map-marker-selector">
              <strong>选择建筑</strong>
              <div className="map-marker-grid">
                {BUILDING_DEFS.filter((def) => !def.key.startsWith("first") || def.key === "firstA" || def.key === "firstB").map((def) => (
                  <button
                    key={def.key}
                    type="button"
                    className={`map-marker-option${markingCandidate.buildingKey === def.key ? " selected" : ""}`}
                    onClick={() => {
                      setMarkingCandidate((prev) => prev ? { ...prev, buildingKey: def.key } : null);
                      confirmMark(def.key);
                    }}
                  >
                    {def.label}
                  </button>
                ))}
              </div>
              <button type="button" className="secondary-button" onClick={cancelMark}>取消</button>
            </div>
          </div>
        )}

        <div className="map-control-stack">
          <div className="map-zoom-hud" aria-live="polite">
            <strong>{Math.round(zoom * 100)}%</strong>
            <span>{dragging ? "拖动中" : "滚轮缩放 · 拖动地图"}</span>
            {routeDistance && <span className="map-route-distance">路径 {routeDistance}</span>}
          </div>

          {/* Building selector for navigation */}
          {building === "campus" && !markingMode && (
            <div className="map-nav-selector">
              <button
                className="icon-button map-tool-button"
                data-tooltip="导航"
                aria-label="选择起点和终点"
                aria-pressed={showNavSelector}
                onClick={() => setShowNavSelector(!showNavSelector)}
              >
                <Navigation size={17} />
              </button>
              {showNavSelector && marks.length >= 2 && (
                <div className="map-nav-selector-dropdown">
                  <label>
                    起点：
                    <select value={navFrom ?? ""} onChange={(e) => setNavFrom(e.target.value || null)}>
                      <option value="">（选择）</option>
                      {marks.map((m) => <option key={m.key} value={m.key}>{buildingDefByKey(m.key)?.label ?? m.key}</option>)}
                    </select>
                  </label>
                  <label>
                    终点：
                    <select value={navTo ?? ""} onChange={(e) => setNavTo(e.target.value || null)}>
                      <option value="">（选择）</option>
                      {marks.map((m) => <option key={m.key} value={m.key}>{buildingDefByKey(m.key)?.label ?? m.key}</option>)}
                    </select>
                  </label>
                </div>
              )}
              {showNavSelector && marks.length < 2 && (
                <div className="map-nav-selector-hint">请先标注至少两个建筑（开启标注模式在地图上点击）</div>
              )}
            </div>
          )}

          {/* Mark toggle */}
          {building === "campus" && (
            <button
              className={`icon-button map-tool-button${markingMode ? " active" : ""}`}
              data-tooltip={markingMode ? "确认标注" : "标注建筑位置"}
              aria-label={markingMode ? "完成标注" : "标注建筑位置"}
              aria-pressed={markingMode}
              onClick={() => {
                setMarkingMode(!markingMode);
                setMarkingCandidate(null);
              }}
            >
              <Crosshair size={17} />
            </button>
          )}

          {/* Mark list */}
          {building === "campus" && marks.length > 0 && (
            <div className="map-mark-list">
              {marks.map((mark) => (
                <div key={mark.key} className="map-mark-item">
                  <span>{buildingDefByKey(mark.key)?.label ?? mark.key}</span>
                  <button
                    type="button"
                    className="map-mark-delete"
                    onClick={() => deleteMark(mark.key)}
                    aria-label={`删除${buildingDefByKey(mark.key)?.label ?? mark.key}标记`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="map-building-controls" aria-label="地图范围">
            <button className={`map-building-button ${building === "campus" ? "active" : ""}`} aria-label="查看校园总图" aria-pressed={building === "campus"} onClick={() => selectBuilding("campus")}>
              <MapIcon size={15} /><span>校园</span>
            </button>
            <button className={`map-building-button ${building === "first" ? "active" : ""}`} aria-label="查看第一教学楼" aria-pressed={building === "first"} onClick={() => selectBuilding("first")}>
              <Building2 size={15} /><span>一教</span>
            </button>
            <button className={`map-building-button ${building === "second" ? "active" : ""}`} aria-label="查看第二教学楼" aria-pressed={building === "second"} onClick={() => selectBuilding("second")}>
              <Building2 size={15} /><span>二教</span>
            </button>
          </div>
          {building !== "campus" && (
            <div className="map-floor-controls" aria-label="楼层切换">
              {[0, 1, 2, 3, 4].map((value) => (
                <button key={value} className={floor === value ? "active" : ""} aria-label={`查看${value + 1}层`} aria-pressed={floor === value} onClick={() => setFloor(value)}>{value + 1}</button>
              ))}
            </div>
          )}
          {building === "campus" && (
            <div className="map-layer-controls" aria-label="校园底图切换">
              <button className={`icon-button map-tool-button ${layer === "campus" ? "active" : ""}`} data-tooltip="校园总图" aria-label="切换到校园总图" aria-pressed={layer === "campus"} onClick={() => setLayer("campus")}><MapIcon size={17} /></button>
              <button className={`icon-button map-tool-button ${layer === "satellite" ? "active" : ""}`} data-tooltip="卫星底图" aria-label="切换到卫星底图" aria-pressed={layer === "satellite"} onClick={() => setLayer("satellite")}><Satellite size={17} /></button>
            </div>
          )}
          <div className="map-zoom-controls" aria-label="地图缩放控制">
            <button className="icon-button map-tool-button" data-tooltip="放大" aria-label="放大地图" onClick={() => zoomBy(1.35)}><Plus size={18} /></button>
            <button className="icon-button map-tool-button" data-tooltip="缩小" aria-label="缩小地图" onClick={() => zoomBy(1 / 1.35)}><Minus size={18} /></button>
            <button className="icon-button map-tool-button" data-tooltip="查看全图" aria-label="查看全图" onClick={resetViewForSource}><LocateFixed size={17} /></button>
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