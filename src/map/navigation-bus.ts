/**
 * Cross-view navigation bus: ScheduleView asks CampusMapView to locate a
 * building and draw a route, without coupling the two components directly.
 *
 * The request is cached in a module-level slot so it survives the React view
 * switch: when the map view mounts later, the pending request is consumed
 * immediately instead of being lost to a listener that did not exist yet.
 */

export interface CampusNavigationRequest {
  /** Building key from campus-buildings.ts (e.g. "firstA"). */
  buildingKey: string;
  /** Original schedule room string, e.g. "一教A-301". */
  room?: string;
  /** Optional starting building key for the route. */
  fromKey?: string;
}

const EVENT = "theia:campus-navigation";

let pending: CampusNavigationRequest | null = null;

export function requestCampusNavigation(request: CampusNavigationRequest): void {
  pending = request;
  window.dispatchEvent(new CustomEvent<CampusNavigationRequest>(EVENT, { detail: request }));
}

export function listenCampusNavigation(handler: (request: CampusNavigationRequest) => void): () => void {
  // Consume a request that arrived before this listener (view switch race).
  if (pending) {
    const request = pending;
    pending = null;
    handler(request);
  }
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<CampusNavigationRequest>).detail;
    if (!detail || typeof detail.buildingKey !== "string") return;
    pending = null;
    handler(detail);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** Clear any un-consumed navigation request (e.g. when leaving the map view). */
export function clearPendingCampusNavigation(): void {
  pending = null;
}
