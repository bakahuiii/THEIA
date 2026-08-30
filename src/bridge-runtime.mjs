export const DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE =
  "桌面数据桥接未加载。为避免将空数据误认为真实数据，THEIA 已停止启动。请重新启动应用；若问题仍然存在，请重新安装。";

const subscriptionMethods = new Set([
  "onSyncProgress",
  "onSnapshot",
  "onAuthStatus",
  "onUpdateStatus",
  "onCourseSelection",
  "onNewMail",
  "onAppearanceMode",
]);

export function createUnavailableDesktopBridge(
  message = DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE,
) {
  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      if (subscriptionMethods.has(property)) return () => () => undefined;
      return async () => {
        throw new Error(message);
      };
    },
  });
}

export function resolveRuntimeBridge({ protocol, nativeBridge, webBridge }) {
  if (nativeBridge) return nativeBridge;
  if (protocol === "file:") return createUnavailableDesktopBridge();
  return webBridge;
}
