import {
  ArrowLeftRight,
  Blend,
  ImagePlus,
  Monitor,
  Moon,
  Palette,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useState,
} from "react";
import { bridge, isDesktop } from "../../bridge";
import {
  type AppearanceMode,
  useAppearance,
} from "../../hooks/useAppearance";
import {
  type ThemePreset,
  usePersonalization,
} from "../../hooks/usePersonalization";
import {
  BUCT_LAKE_PRESET,
  matchesVisualPreset,
  VISUAL_PRESET_GROUPS,
  type VisualPreset,
  type VisualPresetGroup,
} from "../../lib/appearance-presets";
import { deriveGradientPalette } from "../../lib/gradient-map";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ZOOM_PRESETS = [75, 90, 100, 110, 125, 150] as const;

const MODE_OPTIONS: Array<{
  id: AppearanceMode;
  label: string;
  icon: typeof Sun;
}> = [
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
  { id: "system", label: "跟随系统", icon: Monitor },
];

const PRESETS: Array<{
  id: ThemePreset;
  label: string;
  detail: string;
}> = [
  { id: "classic", label: "Classic", detail: "平衡、清透" },
  { id: "midnight", label: "Midnight", detail: "深夜墨绿" },
];

export function AppearanceSettings({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const { mode, resolvedMode, setMode, zoom, setZoom } = useAppearance();
  const {
    preferences,
    setPreset,
    setAppBackground,
    setBackgroundBlur,
    setBackgroundTransparency,
    setBackgroundImage,
    setBackgroundTexture,
    setBackgroundMotion,
    setGradientMap,
    applyVisualSettings,
    applySeasonalVisualSettings,
    saveCustomVisualPreset,
    deleteCustomVisualPreset,
  } = usePersonalization();
  const [motionOpen, setMotionOpen] = useState(false);
  const [gradientOpen, setGradientOpen] = useState(false);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [customPresetName, setCustomPresetName] = useState("");
  const [savePresetError, setSavePresetError] = useState("");
  const hasBackground = preferences.background === "image";
  const paletteSource =
    preferences.gradientMap.syncPalette &&
    preferences.backgroundPalette &&
    preferences.backgroundPaletteSource === preferences.backgroundUrl
      ? preferences.backgroundPalette
      : preferences.gradientMap;
  const gradientPalette = deriveGradientPalette(
    paletteSource,
    resolvedMode,
  );

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setPreset(preset.id);
  };

  const applyVisualPreset = (preset: VisualPreset) => {
    const seasonalPreset = preset.id === BUCT_LAKE_PRESET?.id
      ? BUCT_LAKE_PRESET
      : null;
    if (seasonalPreset) {
      applySeasonalVisualSettings(
        seasonalPreset,
        seasonalPreset.seasonalVariants,
      );
    } else {
      applyVisualSettings(preset);
    }
    onMessage(`已应用 ${preset.label} 外观；同步界面色板，不替换背景图片`);
  };

  const customVisualPresetGroup: VisualPresetGroup | null =
    preferences.customVisualPresets.length > 0
      ? {
          label: "MY PRESETS",
          detail: "保存在这台设备上的个人外观",
          custom: true,
          presets: preferences.customVisualPresets.map((preset) => ({
            ...preset,
            detail:
              (preset.basePreset === "midnight" ? "Midnight" : "Classic") +
              " · 本地预设",
          })),
        }
      : null;
  const visualPresetGroups = customVisualPresetGroup
    ? [...VISUAL_PRESET_GROUPS, customVisualPresetGroup]
    : VISUAL_PRESET_GROUPS;

  const saveCurrentVisualPreset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const savedPreset = saveCustomVisualPreset(customPresetName);
    if (!savedPreset) {
      setSavePresetError(
        customPresetName.trim()
          ? "最多可保存 16 套个人预设。"
          : "请先为这套外观输入名称。",
      );
      return;
    }
    setCustomPresetName("");
    setSavePresetError("");
    setSavePresetOpen(false);
    onMessage(`已将当前外观保存为“${savedPreset.label}”。`);
  };

  const swapGradientColors = () => {
    setGradientMap({
      shadow: preferences.gradientMap.highlight,
      highlight: preferences.gradientMap.shadow,
    });
    onMessage("已对调双色映射的亮部与暗部颜色。");
  };

  const removeCustomVisualPreset = (preset: VisualPreset) => {
    deleteCustomVisualPreset(preset.id);
    onMessage(`已删除个人预设“${preset.label}”。`);
  };

  const updateGradientColor = (
    field: "shadow" | "highlight",
    value: string,
  ) => {
    setGradientMap({ [field]: value });
  };

  const updateGradientStop = (
    field: "shadowPosition" | "highlightPosition",
    value: number,
  ) => {
    const minimumGap = 4;
    const nextValue =
      field === "shadowPosition"
        ? Math.min(value, preferences.gradientMap.highlightPosition - minimumGap)
        : Math.max(value, preferences.gradientMap.shadowPosition + minimumGap);
    setGradientMap({ [field]: nextValue });
  };

  const gradientPositionAtPointer = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.round(
      Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) *
        100,
    );
  };

  const moveNearestGradientStop = (
    event: ReactPointerEvent<HTMLDivElement>,
    field?: "shadowPosition" | "highlightPosition",
  ) => {
    const position = gradientPositionAtPointer(event);
    const target =
      field ??
      (Math.abs(position - preferences.gradientMap.shadowPosition) <=
      Math.abs(position - preferences.gradientMap.highlightPosition)
        ? "shadowPosition"
        : "highlightPosition");
    updateGradientStop(target, position);
    return target;
  };

  const handleGradientRampPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.target instanceof HTMLInputElement) return;
    const target = moveNearestGradientStop(event);
    event.currentTarget.dataset.draggedGradientStop = target;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleGradientRampPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const target = event.currentTarget.dataset.draggedGradientStop;
    if (target !== "shadowPosition" && target !== "highlightPosition") return;
    moveNearestGradientStop(event, target);
  };

  const handleGradientRampPointerEnd = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    delete event.currentTarget.dataset.draggedGradientStop;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const chooseBackground = async () => {
    try {
      const result = await bridge.chooseAppBackground?.();
      if (!result || result.canceled || !result.url) return;
      setAppBackground("image", result);
      onMessage("已应用客户端背景：" + (result.name || "图片"));
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const clearBackground = () => {
    setAppBackground("none");
    setMotionOpen(false);
    setGradientOpen(false);
    onMessage("已移除客户端背景");
  };

  return (
    <section className="settings-section appearance-settings">
      <div className="settings-title">
        <div className="settings-icon teal">
          <Palette size={20} />
        </div>
        <div>
          <h2>外观</h2>
          <p>为 THEIA 设定干净、有层次的本地工作空间。</p>
        </div>
      </div>

      <div className="appearance-subsection-heading">
        <span>INTERFACE THEME</span>
        <strong>基础主题</strong>
        <small>只改变工作区的基础明暗风格，不会改变背景图片。</small>
      </div>
      <div className="appearance-preset-grid" role="list" aria-label="界面主题">
        {PRESETS.map((preset) => (
          <button
            type="button"
            role="listitem"
            key={preset.id}
            className={[
              "appearance-preset",
              "appearance-preset-" + preset.id,
              preferences.preset === preset.id ? "active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => applyPreset(preset)}
            aria-pressed={preferences.preset === preset.id}
          >
            <span className="appearance-preset-swatch" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <strong>{preset.label}</strong>
            <small>{preset.detail}</small>
          </button>
        ))}
      </div>

      <section className="appearance-visual-presets" aria-labelledby="visual-presets-title">
        <div className="appearance-visual-presets-heading">
          <div>
            <span>APPEARANCE PRESETS</span>
            <strong id="visual-presets-title">一体化外观</strong>
          </div>
          <Button
            type="button"
            className="appearance-save-preset-trigger"
            variant="outline"
            size="sm"
            disabled={preferences.customVisualPresets.length >= 16}
            onClick={() => {
              setSavePresetOpen((open) => !open);
              setSavePresetError("");
            }}
            aria-expanded={savePresetOpen}
          >
            <Plus size={15} />
            保存当前为预设
          </Button>
          <small>双色映射、界面色板与背景效果同步调整；背景来源保持不变。</small>
        </div>
        {savePresetOpen && (
          <form
            className="appearance-save-preset-form"
            onSubmit={saveCurrentVisualPreset}
          >
            <label>
              <span>
                <strong>新预设名称</strong>
                <small>保存当前双色映射、背景效果与基础主题。</small>
              </span>
              <input
                autoFocus
                maxLength={36}
                value={customPresetName}
                onChange={(event) => {
                  setCustomPresetName(event.target.value);
                  if (savePresetError) setSavePresetError("");
                }}
                placeholder="例如：夜航蓝金"
                aria-describedby={
                  savePresetError ? "appearance-save-preset-error" : undefined
                }
              />
            </label>
            <div className="appearance-save-preset-actions">
              <Button type="submit" size="sm">
                保存预设
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSavePresetOpen(false);
                  setSavePresetError("");
                }}
              >
                取消
              </Button>
            </div>
            {savePresetError && (
              <p id="appearance-save-preset-error" role="alert">
                {savePresetError}
              </p>
            )}
          </form>
        )}
        {visualPresetGroups.map((group) => (
          <div className="appearance-visual-preset-group" key={group.label}>
            <div className="appearance-visual-preset-group-heading">
              <strong>{group.label}</strong>
              <span>{group.detail}</span>
            </div>
            <div className="appearance-visual-preset-grid" role="list">
              {group.presets.map((preset) => {
                const active = matchesVisualPreset(preset, preferences);
                return (
                  <button
                    type="button"
                    role="listitem"
                    key={preset.id}
                    className={[
                      "appearance-visual-preset",
                      active ? "active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => applyVisualPreset(preset)}
                    aria-pressed={active}
                  >
                    <span
                      className="appearance-visual-preset-swatch"
                      aria-hidden="true"
                      style={
                        {
                          "--visual-preset-shadow": preset.gradientMap.shadow,
                          "--visual-preset-highlight": preset.gradientMap.highlight,
                          "--visual-preset-shadow-stop": `${preset.gradientMap.shadowPosition}%`,
                          "--visual-preset-highlight-stop": `${preset.gradientMap.highlightPosition}%`,
                        } as CSSProperties
                      }
                    >
                      <i />
                      <i />
                    </span>
                    <span className="appearance-visual-preset-copy">
                      <strong>{preset.label}</strong>
                      <small>{preset.detail}</small>
                    </span>
                    <span className="appearance-visual-preset-meta">
                      <i style={{ backgroundColor: preset.gradientMap.shadow }} />
                      <i style={{ backgroundColor: preset.gradientMap.highlight }} />
                      <output>{preset.backgroundTransparency}% 透光</output>
                    </span>
                  </button>
                );
              })}
            </div>
            {group.custom && (
              <div className="appearance-custom-preset-actions">
                {group.presets.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    onClick={() => removeCustomVisualPreset(preset)}
                    title={`删除“${preset.label}”`}
                  >
                    <Trash2 size={13} />
                    删除 {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>

      <div className="appearance-background-section">
        <div
          className={[
            "appearance-background-preview",
            hasBackground ? "has-image" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label="客户端背景预览"
        >
          <div>
            <span>THEIA</span>
            <strong>客户端背景</strong>
            <small>
              {hasBackground
                ? preferences.backgroundName || "已选择图片"
                : "默认保持纯净工作界面"}
            </small>
          </div>
          <i aria-hidden="true" />
        </div>
        <div className="appearance-background-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void chooseBackground()}
          >
            <ImagePlus size={15} />
            选择图片
          </Button>
          {hasBackground && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setGradientOpen((open) => !open);
                setMotionOpen(false);
              }}
              aria-expanded={gradientOpen}
            >
              <Blend size={15} />
              双色映射
            </Button>
          )}
          {hasBackground && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setMotionOpen((open) => !open);
                setGradientOpen(false);
              }}
              aria-expanded={motionOpen}
            >
              <SlidersHorizontal size={15} />
              背景效果
            </Button>
          )}
          {hasBackground && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearBackground}
            >
              <Trash2 size={15} />
              移除图片
            </Button>
          )}
        </div>
        {hasBackground && gradientOpen && (
          <div
            className="appearance-gradient-map-popover"
            role="dialog"
            aria-label="双色渐变映射设置"
          >
            <div className="appearance-motion-heading">
              <div>
                <span>DUOTONE ENGINE</span>
                <strong>双色渐变映射</strong>
              </div>
              <button
                type="button"
                className="appearance-motion-close"
                onClick={() => setGradientOpen(false)}
                aria-label="关闭双色渐变映射设置"
              >
                <X size={15} />
              </button>
            </div>
            <div
              className="gradient-map-ramp"
              onPointerDown={handleGradientRampPointerDown}
              onPointerMove={handleGradientRampPointerMove}
              onPointerUp={handleGradientRampPointerEnd}
              onPointerCancel={handleGradientRampPointerEnd}
              style={{
                "--gradient-map-shadow-stop": `${preferences.gradientMap.shadowPosition}%`,
                "--gradient-map-highlight-stop": `${preferences.gradientMap.highlightPosition}%`,
                background: `linear-gradient(90deg, ${preferences.gradientMap.shadow} 0%, ${preferences.gradientMap.shadow} ${preferences.gradientMap.shadowPosition}%, ${preferences.gradientMap.highlight} ${preferences.gradientMap.highlightPosition}%, ${preferences.gradientMap.highlight} 100%)`,
              } as CSSProperties}
            >
              <input
                className="gradient-map-stop-input gradient-map-stop-shadow"
                type="range"
                min="0"
                max={Math.max(0, preferences.gradientMap.highlightPosition - 4)}
                value={preferences.gradientMap.shadowPosition}
                onChange={(event) =>
                  updateGradientStop(
                    "shadowPosition",
                    Number(event.target.value),
                  )
                }
                style={
                  {
                    "--gradient-map-stop-color": preferences.gradientMap.shadow,
                  } as CSSProperties
                }
                aria-label="调整暗部映射起点"
              />
              <input
                className="gradient-map-stop-input gradient-map-stop-highlight"
                type="range"
                min={preferences.gradientMap.shadowPosition + 4}
                max="100"
                value={preferences.gradientMap.highlightPosition}
                onChange={(event) =>
                  updateGradientStop(
                    "highlightPosition",
                    Number(event.target.value),
                  )
                }
                style={
                  {
                    "--gradient-map-stop-color": preferences.gradientMap.highlight,
                  } as CSSProperties
                }
                aria-label="调整高光映射终点"
              />
            </div>
            <div className="gradient-map-stop-values" aria-live="polite">
              <span>
                <i style={{ backgroundColor: preferences.gradientMap.shadow }} />
                暗部起点 <output>{preferences.gradientMap.shadowPosition}%</output>
              </span>
              <span>
                <i style={{ backgroundColor: preferences.gradientMap.highlight }} />
                高光终点 <output>{preferences.gradientMap.highlightPosition}%</output>
              </span>
            </div>
            <div className="gradient-map-color-grid">
              <label className="gradient-map-color-control">
                <span>
                  <strong>暗部颜色</strong>
                  <small>控制线稿、阴影与图案深处</small>
                </span>
                <span>
                  <input
                    type="color"
                    value={preferences.gradientMap.shadow}
                    onChange={(event) =>
                      updateGradientColor("shadow", event.target.value)
                    }
                    aria-label="选择暗部颜色"
                  />
                  <output>{preferences.gradientMap.shadow.toUpperCase()}</output>
                </span>
              </label>
              <label className="gradient-map-color-control">
                <span>
                  <strong>亮部颜色</strong>
                  <small>控制纸张、高光与背景留白</small>
                </span>
                <span>
                  <input
                    type="color"
                    value={preferences.gradientMap.highlight}
                    onChange={(event) =>
                      updateGradientColor("highlight", event.target.value)
                    }
                    aria-label="选择亮部颜色"
                  />
                  <output>{preferences.gradientMap.highlight.toUpperCase()}</output>
                </span>
              </label>
            </div>
            <button
              type="button"
              className="gradient-map-swap-button"
              onClick={swapGradientColors}
            >
              <ArrowLeftRight size={15} />
              对调亮暗部颜色
            </button>
            <div className="gradient-map-palette-preview">
              <span>界面色板</span>
              <i
                style={{
                  backgroundColor: gradientPalette.variables["--background"],
                }}
                title="应用背景"
              />
              <i
                style={{ backgroundColor: gradientPalette.variables["--card"] }}
                title="信息面板"
              />
              <i
                style={{
                  backgroundColor: gradientPalette.variables["--primary"],
                }}
                title="强调色"
              />
              <i
                style={{
                  backgroundColor: gradientPalette.variables["--foreground"],
                }}
                title="文字颜色"
              />
              <small>{preferences.backgroundPalette ? "从当前背景的主色与辅助色提取，并保持表面克制" : "等待背景图片取色完成"}</small>
            </div>
            <div className="appearance-motion-toggle">
              <span>
                <strong>应用到背景</strong>
                <small>保留图像纹理，只替换明暗两端的颜色</small>
              </span>
              <Switch
                checked={preferences.gradientMap.enabled}
                onCheckedChange={(enabled) => setGradientMap({ enabled })}
              />
            </div>
            <div className="appearance-motion-toggle">
              <span>
                <strong>同步界面色板</strong>
                <small>从背景照片采样主色与辅助色，生成克制且可读的界面色板</small>
              </span>
              <Switch
                checked={preferences.gradientMap.syncPalette}
                onCheckedChange={(syncPalette) =>
                  setGradientMap({ syncPalette })
                }
              />
            </div>
            <div className="gradient-map-mode-note">
              <Blend size={14} />
              <span>
                当前按{gradientPalette.mode === "light" ? "浅色" : "深色"}
                模式生成完整色板：结构保持中性，强调色来自当前背景。
              </span>
            </div>
          </div>
        )}
        {hasBackground && motionOpen && (
          <div
            className="appearance-motion-popover"
            role="dialog"
            aria-label="背景效果设置"
          >
            <div className="appearance-motion-heading">
              <div>
                <span>BACKGROUND LAYERS</span>
                <strong>背景效果</strong>
              </div>
              <button
                type="button"
                className="appearance-motion-close"
                onClick={() => setMotionOpen(false)}
                aria-label="关闭背景动效设置"
              >
                <X size={15} />
              </button>
            </div>
            <label className="appearance-motion-slider">
              <span>
                <strong>原图模糊</strong>
                <small>0px 保持原图清晰；数值越高越柔和</small>
              </span>
              <input
                type="range"
                min="0"
                max="64"
                step="1"
                value={preferences.backgroundBlur}
                onChange={(event) =>
                  setBackgroundBlur(Number(event.target.value))
                }
              />
              <output>{preferences.backgroundBlur}px</output>
            </label>
            <label className="appearance-motion-slider">
              <span>
                <strong>面板透明度</strong>
                <small>0% 为实心面板，100% 完全透出背景</small>
              </span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={preferences.backgroundTransparency}
                onChange={(event) =>
                  setBackgroundTransparency(Number(event.target.value))
                }
              />
              <output>{preferences.backgroundTransparency}%</output>
            </label>
            <label className="appearance-motion-slider">
              <span>
                <strong>图像强度</strong>
                <small>控制背景原图的可见程度，0% 为完全隐藏</small>
              </span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={preferences.backgroundImage.opacity}
                onChange={(event) =>
                  setBackgroundImage({ opacity: Number(event.target.value) })
                }
              />
              <output>{preferences.backgroundImage.opacity}%</output>
            </label>
            <label className="appearance-motion-slider">
              <span>
                <strong>图像亮度</strong>
                <small>调整背景明暗，范围可低于或高于原图</small>
              </span>
              <input
                type="range"
                min="20"
                max="220"
                step="1"
                value={preferences.backgroundImage.brightness}
                onChange={(event) =>
                  setBackgroundImage({ brightness: Number(event.target.value) })
                }
              />
              <output>{preferences.backgroundImage.brightness}%</output>
            </label>
            <label className="appearance-motion-slider">
              <span>
                <strong>图像对比度</strong>
                <small>控制背景纹理的黑白层次和冲击力</small>
              </span>
              <input
                type="range"
                min="20"
                max="240"
                step="1"
                value={preferences.backgroundImage.contrast}
                onChange={(event) =>
                  setBackgroundImage({ contrast: Number(event.target.value) })
                }
              />
              <output>{preferences.backgroundImage.contrast}%</output>
            </label>
            <label className="appearance-motion-slider">
              <span>
                <strong>图像饱和度</strong>
                <small>从纯灰到高饱和，单独控制原图色彩</small>
              </span>
              <input
                type="range"
                min="0"
                max="260"
                step="1"
                value={preferences.backgroundImage.saturation}
                onChange={(event) =>
                  setBackgroundImage({ saturation: Number(event.target.value) })
                }
              />
              <output>{preferences.backgroundImage.saturation}%</output>
            </label>
            <div className="appearance-motion-toggle">
              <span>
                <strong>图片纹理</strong>
                <small>用当前图片生成极淡的拓印质感</small>
              </span>
              <Switch
                checked={preferences.backgroundTexture.enabled}
                onCheckedChange={(enabled) =>
                  setBackgroundTexture({ enabled })
                }
              />
            </div>
            <label className="appearance-motion-slider">
              <span>
                <strong>纹理强度</strong>
                <small>控制拓印质感的醒目程度</small>
              </span>
              <input
                type="range"
                min="0"
                max="30"
                step="0.1"
                value={preferences.backgroundTexture.opacity}
                disabled={!preferences.backgroundTexture.enabled}
                onChange={(event) =>
                  setBackgroundTexture({ opacity: Number(event.target.value) })
                }
              />
              <output>
                {preferences.backgroundTexture.opacity.toFixed(1)}%
              </output>
            </label>
            <label className="appearance-motion-slider">
              <span>
                <strong>纹理铺设</strong>
                <small>控制纹理覆盖的页面高度</small>
              </span>
              <input
                type="range"
                min="100"
                max="500"
                step="10"
                value={preferences.backgroundTexture.height}
                disabled={!preferences.backgroundTexture.enabled}
                onChange={(event) =>
                  setBackgroundTexture({ height: Number(event.target.value) })
                }
              />
              <output>
                {(preferences.backgroundTexture.height / 100).toFixed(1)} 屏
              </output>
            </label>
            <div className="appearance-motion-toggle">
              <span>
                <strong>鼠标视差</strong>
                <small>背景随指针轻微移动</small>
              </span>
              <Switch
                checked={preferences.backgroundMotion.enabled}
                onCheckedChange={(enabled) =>
                  setBackgroundMotion({ enabled })
                }
              />
            </div>
            <label className="appearance-motion-slider">
              <span>
                <strong>视差幅度</strong>
                <small>控制随指针移动的距离</small>
              </span>
              <input
                type="range"
                min="0"
                max="120"
                step="1"
                value={preferences.backgroundMotion.intensity}
                disabled={!preferences.backgroundMotion.enabled}
                onChange={(event) =>
                  setBackgroundMotion({ intensity: Number(event.target.value) })
                }
              />
              <output>{preferences.backgroundMotion.intensity}px</output>
            </label>
            <label className="appearance-motion-slider">
              <span>
                <strong>背景缩放</strong>
                <small>放大取景，避免移动时露出边缘</small>
              </span>
              <input
                type="range"
                min="100"
                max="180"
                step="1"
                value={preferences.backgroundMotion.scale}
                disabled={!preferences.backgroundMotion.enabled}
                onChange={(event) =>
                  setBackgroundMotion({ scale: Number(event.target.value) })
                }
              />
              <output>{preferences.backgroundMotion.scale}%</output>
            </label>
            <div className="appearance-motion-note">
              <Sparkles size={14} />
              <span>纹理始终来自当前选中的背景图片。</span>
            </div>
          </div>
        )}
      </div>

      <div className="setting-row appearance-theme-row">
        <span>
          <strong>主题模式</strong>
          <small>
            {mode === "system"
              ? "跟随系统，当前为" +
                (resolvedMode === "dark" ? "深色" : "浅色")
              : "立即应用到全部工作区"}
          </small>
        </span>
        <Select
          value={mode}
          onValueChange={(value) => setMode(value as AppearanceMode)}
        >
          <SelectTrigger className="appearance-theme-select" size="sm">
            <SelectValue placeholder="选择主题" />
          </SelectTrigger>
          <SelectContent position="popper">
            {MODE_OPTIONS.map(({ id, label, icon: Icon }) => (
              <SelectItem key={id} value={id}>
                <Icon aria-hidden="true" />
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isDesktop && (
        <div className="setting-row appearance-zoom-row">
          <span>
            <strong>界面缩放</strong>
            <small>当前 {zoom}%</small>
          </span>
          <div className="appearance-zoom-group" role="group" aria-label="界面缩放">
            {ZOOM_PRESETS.map((percent) => (
              <Button
                key={percent}
                className="appearance-zoom-button"
                variant={zoom === percent ? "default" : "outline"}
                size="xs"
                onClick={() => setZoom(percent)}
              >
                {percent}%
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
