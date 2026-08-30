import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeftRight, Blend, ImagePlus, SlidersHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { Personalization } from "../../../hooks/usePersonalization";
import type { GradientPalette } from "../../../lib/gradient-map";

type GradientStopField = "shadowPosition" | "highlightPosition";

export type AppearanceBackgroundControlsProps = {
  preferences: Personalization;
  hasBackground: boolean;
  gradientPalette: GradientPalette;
  gradientOpen: boolean;
  motionOpen: boolean;
  onChooseBackground: () => void;
  onClearBackground: () => void;
  onToggleGradient: () => void;
  onToggleMotion: () => void;
  onCloseGradient: () => void;
  onCloseMotion: () => void;
  onSwapGradientColors: () => void;
  onUpdateGradientColor: (field: "shadow" | "highlight", value: string) => void;
  onUpdateGradientStop: (field: GradientStopField, value: number) => void;
  onGradientRampPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onGradientRampPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onGradientRampPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  setGradientMap: (partial: Partial<Personalization["gradientMap"]>) => void;
  setBackgroundBlur: (value: number) => void;
  setBackgroundTransparency: (value: number) => void;
  setBackgroundImage: (partial: Partial<Personalization["backgroundImage"]>) => void;
  setBackgroundTexture: (partial: Partial<Personalization["backgroundTexture"]>) => void;
  setBackgroundMotion: (partial: Partial<Personalization["backgroundMotion"]>) => void;
};

export function AppearanceBackgroundControls({
  preferences,
  hasBackground,
  gradientPalette,
  gradientOpen,
  motionOpen,
  onChooseBackground,
  onClearBackground,
  onToggleGradient,
  onToggleMotion,
  onCloseGradient,
  onCloseMotion,
  onSwapGradientColors,
  onUpdateGradientColor,
  onUpdateGradientStop,
  onGradientRampPointerDown,
  onGradientRampPointerMove,
  onGradientRampPointerEnd,
  setGradientMap,
  setBackgroundBlur,
  setBackgroundTransparency,
  setBackgroundImage,
  setBackgroundTexture,
  setBackgroundMotion,
}: AppearanceBackgroundControlsProps) {
  return (
    <div className="appearance-background-section">
      <div className={["appearance-background-preview", hasBackground ? "has-image" : ""].filter(Boolean).join(" ")} aria-label="客户端背景预览">
        <div>
          <span>THEIA</span>
          <strong>客户端背景</strong>
          <small>{hasBackground ? preferences.backgroundName || "已选择图片" : "默认保持纯净工作界面"}</small>
        </div>
        <i aria-hidden="true" />
      </div>
      <div className="appearance-background-actions">
        <Button type="button" variant="outline" size="sm" onClick={onChooseBackground}><ImagePlus size={15} />选择图片</Button>
        {hasBackground && <Button type="button" variant="outline" size="sm" onClick={onToggleGradient} aria-expanded={gradientOpen}><Blend size={15} />双色映射</Button>}
        {hasBackground && <Button type="button" variant="outline" size="sm" onClick={onToggleMotion} aria-expanded={motionOpen}><SlidersHorizontal size={15} />背景效果</Button>}
        {hasBackground && <Button type="button" variant="ghost" size="sm" onClick={onClearBackground}><Trash2 size={15} />移除图片</Button>}
      </div>
      {hasBackground && gradientOpen && (
        <div className="appearance-gradient-map-popover" role="dialog" aria-label="双色渐变映射设置">
          <div className="appearance-motion-heading">
            <div><span>DUOTONE ENGINE</span><strong>双色渐变映射</strong></div>
            <button type="button" className="appearance-motion-close" onClick={onCloseGradient} aria-label="关闭双色渐变映射设置"><X size={15} /></button>
          </div>
          <div
            className="gradient-map-ramp"
            onPointerDown={onGradientRampPointerDown}
            onPointerMove={onGradientRampPointerMove}
            onPointerUp={onGradientRampPointerEnd}
            onPointerCancel={onGradientRampPointerEnd}
            style={{
              "--gradient-map-shadow-stop": `${preferences.gradientMap.shadowPosition}%`,
              "--gradient-map-highlight-stop": `${preferences.gradientMap.highlightPosition}%`,
              background: `linear-gradient(90deg, ${preferences.gradientMap.shadow} 0%, ${preferences.gradientMap.shadow} ${preferences.gradientMap.shadowPosition}%, ${preferences.gradientMap.highlight} ${preferences.gradientMap.highlightPosition}%, ${preferences.gradientMap.highlight} 100%)`,
            } as CSSProperties}
          >
            <input className="gradient-map-stop-input gradient-map-stop-shadow" type="range" min="0" max={Math.max(0, preferences.gradientMap.highlightPosition - 4)} value={preferences.gradientMap.shadowPosition} onChange={(event) => onUpdateGradientStop("shadowPosition", Number(event.target.value))} style={{ "--gradient-map-stop-color": preferences.gradientMap.shadow } as CSSProperties} aria-label="调整暗部映射起点" />
            <input className="gradient-map-stop-input gradient-map-stop-highlight" type="range" min={preferences.gradientMap.shadowPosition + 4} max="100" value={preferences.gradientMap.highlightPosition} onChange={(event) => onUpdateGradientStop("highlightPosition", Number(event.target.value))} style={{ "--gradient-map-stop-color": preferences.gradientMap.highlight } as CSSProperties} aria-label="调整高光映射终点" />
          </div>
          <div className="gradient-map-stop-values" aria-live="polite"><span><i style={{ backgroundColor: preferences.gradientMap.shadow }} />暗部起点 <output>{preferences.gradientMap.shadowPosition}%</output></span><span><i style={{ backgroundColor: preferences.gradientMap.highlight }} />高光终点 <output>{preferences.gradientMap.highlightPosition}%</output></span></div>
          <div className="gradient-map-color-grid">
            <label className="gradient-map-color-control"><span><strong>暗部颜色</strong><small>控制线稿、阴影与图案深处</small></span><span><input type="color" value={preferences.gradientMap.shadow} onChange={(event) => onUpdateGradientColor("shadow", event.target.value)} aria-label="选择暗部颜色" /><output>{preferences.gradientMap.shadow.toUpperCase()}</output></span></label>
            <label className="gradient-map-color-control"><span><strong>亮部颜色</strong><small>控制纸张、高光与背景留白</small></span><span><input type="color" value={preferences.gradientMap.highlight} onChange={(event) => onUpdateGradientColor("highlight", event.target.value)} aria-label="选择亮部颜色" /><output>{preferences.gradientMap.highlight.toUpperCase()}</output></span></label>
          </div>
          <button type="button" className="gradient-map-swap-button" onClick={onSwapGradientColors}><ArrowLeftRight size={15} />对调亮暗部颜色</button>
          <div className="gradient-map-palette-preview">
            <span>界面色板</span>
            <i style={{ backgroundColor: gradientPalette.variables["--background"] }} title="应用背景" />
            <i style={{ backgroundColor: gradientPalette.variables["--card"] }} title="信息面板" />
            <i style={{ backgroundColor: gradientPalette.variables["--primary"] }} title="强调色" />
            <i style={{ backgroundColor: gradientPalette.variables["--foreground"] }} title="文字颜色" />
            <small>{preferences.backgroundPalette ? "从当前背景的主色与辅助色提取，并保持表面克制" : "等待背景图片取色完成"}</small>
          </div>
          <div className="appearance-motion-toggle"><span><strong>应用到背景</strong><small>保留图像纹理，只替换明暗两端的颜色</small></span><Switch checked={preferences.gradientMap.enabled} onCheckedChange={(enabled) => setGradientMap({ enabled })} /></div>
          <div className="appearance-motion-toggle"><span><strong>同步界面色板</strong><small>从背景照片采样主色与辅助色，生成克制且可读的界面色板</small></span><Switch checked={preferences.gradientMap.syncPalette} onCheckedChange={(syncPalette) => setGradientMap({ syncPalette })} /></div>
          <div className="gradient-map-mode-note"><Blend size={14} /><span>当前按{gradientPalette.mode === "light" ? "浅色" : "深色"}模式生成完整色板：结构保持中性，强调色来自当前背景。</span></div>
        </div>
      )}
      {hasBackground && motionOpen && (
        <div className="appearance-motion-popover" role="dialog" aria-label="背景效果设置">
          <div className="appearance-motion-heading"><div><span>BACKGROUND LAYERS</span><strong>背景效果</strong></div><button type="button" className="appearance-motion-close" onClick={onCloseMotion} aria-label="关闭背景动效设置"><X size={15} /></button></div>
          <label className="appearance-motion-slider"><span><strong>原图模糊</strong><small>0px 保持原图清晰；数值越高越柔和</small></span><input type="range" min="0" max="64" step="1" value={preferences.backgroundBlur} onChange={(event) => setBackgroundBlur(Number(event.target.value))} /><output>{preferences.backgroundBlur}px</output></label>
          <label className="appearance-motion-slider"><span><strong>面板透明度</strong><small>0% 为实心面板，100% 完全透出背景</small></span><input type="range" min="0" max="100" step="1" value={preferences.backgroundTransparency} onChange={(event) => setBackgroundTransparency(Number(event.target.value))} /><output>{preferences.backgroundTransparency}%</output></label>
          <label className="appearance-motion-slider"><span><strong>图像强度</strong><small>控制背景原图的可见程度，0% 为完全隐藏</small></span><input type="range" min="0" max="100" step="1" value={preferences.backgroundImage.opacity} onChange={(event) => setBackgroundImage({ opacity: Number(event.target.value) })} /><output>{preferences.backgroundImage.opacity}%</output></label>
          <label className="appearance-motion-slider"><span><strong>图像亮度</strong><small>调整背景明暗，范围可低于或高于原图</small></span><input type="range" min="20" max="220" step="1" value={preferences.backgroundImage.brightness} onChange={(event) => setBackgroundImage({ brightness: Number(event.target.value) })} /><output>{preferences.backgroundImage.brightness}%</output></label>
          <label className="appearance-motion-slider"><span><strong>图像对比度</strong><small>控制背景纹理的黑白层次和冲击力</small></span><input type="range" min="20" max="240" step="1" value={preferences.backgroundImage.contrast} onChange={(event) => setBackgroundImage({ contrast: Number(event.target.value) })} /><output>{preferences.backgroundImage.contrast}%</output></label>
          <label className="appearance-motion-slider"><span><strong>图像饱和度</strong><small>从纯灰到高饱和，单独控制原图色彩</small></span><input type="range" min="0" max="260" step="1" value={preferences.backgroundImage.saturation} onChange={(event) => setBackgroundImage({ saturation: Number(event.target.value) })} /><output>{preferences.backgroundImage.saturation}%</output></label>
          <div className="appearance-motion-toggle"><span><strong>图片纹理</strong><small>用当前图片生成极淡的拓印质感</small></span><Switch checked={preferences.backgroundTexture.enabled} onCheckedChange={(enabled) => setBackgroundTexture({ enabled })} /></div>
          <label className="appearance-motion-slider"><span><strong>纹理强度</strong><small>控制拓印质感的醒目程度</small></span><input type="range" min="0" max="30" step="0.1" value={preferences.backgroundTexture.opacity} disabled={!preferences.backgroundTexture.enabled} onChange={(event) => setBackgroundTexture({ opacity: Number(event.target.value) })} /><output>{preferences.backgroundTexture.opacity.toFixed(1)}%</output></label>
          <label className="appearance-motion-slider"><span><strong>纹理铺设</strong><small>控制纹理覆盖的页面高度</small></span><input type="range" min="100" max="500" step="10" value={preferences.backgroundTexture.height} disabled={!preferences.backgroundTexture.enabled} onChange={(event) => setBackgroundTexture({ height: Number(event.target.value) })} /><output>{(preferences.backgroundTexture.height / 100).toFixed(1)} 屏</output></label>
          <div className="appearance-motion-toggle"><span><strong>鼠标视差</strong><small>背景随指针轻微移动</small></span><Switch checked={preferences.backgroundMotion.enabled} onCheckedChange={(enabled) => setBackgroundMotion({ enabled })} /></div>
          <label className="appearance-motion-slider"><span><strong>视差幅度</strong><small>控制随指针移动的距离</small></span><input type="range" min="0" max="120" step="1" value={preferences.backgroundMotion.intensity} disabled={!preferences.backgroundMotion.enabled} onChange={(event) => setBackgroundMotion({ intensity: Number(event.target.value) })} /><output>{preferences.backgroundMotion.intensity}px</output></label>
          <label className="appearance-motion-slider"><span><strong>背景缩放</strong><small>放大取景，避免移动时露出边缘</small></span><input type="range" min="100" max="180" step="1" value={preferences.backgroundMotion.scale} disabled={!preferences.backgroundMotion.enabled} onChange={(event) => setBackgroundMotion({ scale: Number(event.target.value) })} /><output>{preferences.backgroundMotion.scale}%</output></label>
          <div className="appearance-motion-note"><Sparkles size={14} /><span>纹理始终来自当前选中的背景图片。</span></div>
        </div>
      )}
    </div>
  );
}
