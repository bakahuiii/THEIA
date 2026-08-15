import { lazy, Suspense } from "react";

const ParallaxScene = lazy(() => import("./parallax3d/ParallaxScene"));

export function ScenePresetHost({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <div className="theia-parallax-scene-host" aria-hidden="true">
      <Suspense fallback={null}>
        <ParallaxScene />
      </Suspense>
    </div>
  );
}
