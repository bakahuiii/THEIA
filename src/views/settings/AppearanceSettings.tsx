import {
  ChevronDown,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Sun,
} from "lucide-react";
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { bridge, isDesktop } from "../../bridge";
import { type AppearanceMode, useAppearance } from "../../hooks/useAppearance";
import {
  type ThemePreset,
  usePersonalization,
} from "../../hooks/usePersonalization";
import {
  BUCT_LAKE_PRESET,
  VISUAL_PRESET_GROUPS,
  type VisualPreset,
  type VisualPresetGroup,
} from "../../lib/appearance-presets";
import { deriveGradientPalette } from "../../lib/gradient-map";
import {
  DEFAULT_PARALLAX_TUNING,
  PARALLAX_TUNING_EVENT,
  PARALLAX_TUNING_GROUPS,
  publishParallaxTuning,
  readParallaxTuning,
  type ParallaxTuning,
} from "../../components/parallax3d/parallax-tuning";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppearanceBackgroundControls } from "./appearance/AppearanceBackgroundControls";
import { AppearanceVisualPresets } from "./appearance/AppearanceVisualPresets";

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
  // The persisted ids predate the visible names and were wired in reverse.
  // Keep the ids for migration, but present the style they actually render.
  { id: "midnight", label: "Classic", detail: "平衡、清透" },
  { id: "classic", label: "Midnight", detail: "深夜墨绿" },
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
  const [sceneTuning, setSceneTuning] = useState<ParallaxTuning>(() => readParallaxTuning());
  const sceneTuningRef = useRef(sceneTuning);
  const hasBackground = preferences.background === "image";
  const sceneEnabled = preferences.scene === "parallax-3d";
  const duotoneActive = hasBackground && preferences.gradientMap.enabled;
  const paletteSource = preferences.gradientMap.syncPalette && preferences.backgroundPalette && preferences.backgroundPaletteSource === preferences.backgroundUrl
    ? preferences.backgroundPalette
    : preferences.gradientMap;
  const gradientPalette = deriveGradientPalette(paletteSource, resolvedMode);

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    if (duotoneActive) return;
    setPreset(preset.id);
  };

  const applyVisualPreset = (preset: VisualPreset) => {
    const seasonalPreset = preset.id === BUCT_LAKE_PRESET?.id ? BUCT_LAKE_PRESET : null;
    if (seasonalPreset) {
      applySeasonalVisualSettings(seasonalPreset, seasonalPreset.seasonalVariants);
    } else {
      applyVisualSettings(preset);
    }
    onMessage(`已应用 ${preset.label} 外观；同步界面色板，不替换背景图片`);
  };

  const customVisualPresetGroup: VisualPresetGroup | null = preferences.customVisualPresets.length > 0
    ? {
        label: "MY PRESETS",
        detail: "保存在这台设备上的个人外观",
        custom: true,
        presets: preferences.customVisualPresets.map((preset) => ({
          ...preset,
          detail: (preset.basePreset === "midnight" ? "Classic" : "Midnight") + " · 本地预设",
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
      setSavePresetError(customPresetName.trim() ? "最多可保存 16 套个人预设。" : "请先为这套外观输入名称。");
      return;
    }
    setCustomPresetName("");
    setSavePresetError("");
    setSavePresetOpen(false);
    onMessage(`已将当前外观保存为“${savedPreset.label}”。`);
  };

  const swapGradientColors = () => {
    setGradientMap({ shadow: preferences.gradientMap.highlight, highlight: preferences.gradientMap.shadow });
    onMessage("已对调双色映射的亮部与暗部颜色。");
  };

  const removeCustomVisualPreset = (preset: VisualPreset) => {
    deleteCustomVisualPreset(preset.id);
    onMessage(`已删除个人预设“${preset.label}”。`);
  };

  const updateGradientColor = (field: "shadow" | "highlight", value: string) => {
    setGradientMap({ [field]: value });
  };

  const updateGradientStop = (field: "shadowPosition" | "highlightPosition", value: number) => {
    const minimumGap = 4;
    const nextValue = field === "shadowPosition"
      ? Math.min(value, preferences.gradientMap.highlightPosition - minimumGap)
      : Math.max(value, preferences.gradientMap.shadowPosition + minimumGap);
    setGradientMap({ [field]: nextValue });
  };

  const gradientPositionAtPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * 100);
  };

  const moveNearestGradientStop = (
    event: ReactPointerEvent<HTMLDivElement>,
    field?: "shadowPosition" | "highlightPosition",
  ) => {
    const position = gradientPositionAtPointer(event);
    const target = field ?? (Math.abs(position - preferences.gradientMap.shadowPosition) <= Math.abs(position - preferences.gradientMap.highlightPosition) ? "shadowPosition" : "highlightPosition");
    updateGradientStop(target, position);
    return target;
  };

  const handleGradientRampPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    const target = moveNearestGradientStop(event);
    event.currentTarget.dataset.draggedGradientStop = target;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleGradientRampPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget.dataset.draggedGradientStop;
    if (target !== "shadowPosition" && target !== "highlightPosition") return;
    moveNearestGradientStop(event, target);
  };

  const handleGradientRampPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    delete event.currentTarget.dataset.draggedGradientStop;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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

  useEffect(() => {
    sceneTuningRef.current = sceneTuning;
  }, [sceneTuning]);

  useEffect(() => {
    const onTuningChange = (event: Event) => {
      const detail = (event as CustomEvent<{ tuning?: ParallaxTuning }>).detail;
      if (detail?.tuning) {
        sceneTuningRef.current = detail.tuning;
        setSceneTuning(detail.tuning);
      }
    };
    window.addEventListener(PARALLAX_TUNING_EVENT, onTuningChange);
    return () => window.removeEventListener(PARALLAX_TUNING_EVENT, onTuningChange);
  }, []);

  const updateSceneTuning = <K extends keyof ParallaxTuning>(key: K, value: ParallaxTuning[K]) => {
    // Keep the persistence/event side effect outside React's state updater.
    // StrictMode may evaluate an updater more than once during development.
    const next = { ...sceneTuningRef.current, [key]: value } as ParallaxTuning;
    sceneTuningRef.current = next;
    setSceneTuning(next);
    publishParallaxTuning(next, "settings");
  };

  const resetSceneTuning = () => {
    const next = { ...DEFAULT_PARALLAX_TUNING };
    sceneTuningRef.current = next;
    setSceneTuning(next);
    publishParallaxTuning(next, "settings");
    onMessage("已恢复 3D 墨景默认参数");
  };

  return (
    <section className="settings-section appearance-settings">
      <div className="settings-title">
        <div className="settings-icon teal"><Palette size={20} /></div>
        <div><h2>外观</h2><p>为 THEIA 设定干净、有层次的本地工作空间。</p></div>
      </div>

      <div className="appearance-subsection-heading">
        <span>INTERFACE THEME</span>
        <strong>基础主题</strong>
        <small>只改变工作区的基础明暗风格，不会改变背景图片。</small>
      </div>
      <div className="appearance-preset-grid" role="list" aria-label="界面主题">
        {PRESETS.map((preset) => (
          <button type="button" role="listitem" key={preset.id} className={["appearance-preset", `appearance-preset-${preset.id}`, preferences.preset === preset.id ? "active" : ""].filter(Boolean).join(" ")} onClick={() => applyPreset(preset)} disabled={duotoneActive} aria-disabled={duotoneActive} aria-pressed={preferences.preset === preset.id}>
            <span className="appearance-preset-swatch" aria-hidden="true"><i /><i /><i /></span>
            <strong>{preset.label}</strong>
            <small>{preset.detail}</small>
          </button>
        ))}
      </div>
      {duotoneActive && <p className="appearance-theme-disabled-note">双色映射开启时，基础主题样式由双色映射接管，此设置暂不可用。</p>}

      <AppearanceVisualPresets
        preferences={preferences}
        visualPresetGroups={visualPresetGroups}
        savePresetOpen={savePresetOpen}
        customPresetName={customPresetName}
        savePresetError={savePresetError}
        onToggleSavePreset={() => { setSavePresetOpen((open) => !open); setSavePresetError(""); }}
        onCustomPresetNameChange={(value) => { setCustomPresetName(value); if (savePresetError) setSavePresetError(""); }}
        onSavePreset={saveCurrentVisualPreset}
        onCancelSavePreset={() => { setSavePresetOpen(false); setSavePresetError(""); }}
        onApplyPreset={applyVisualPreset}
        onRemovePreset={removeCustomVisualPreset}
      />

      <AppearanceBackgroundControls
        preferences={preferences}
        hasBackground={hasBackground}
        gradientPalette={gradientPalette}
        gradientOpen={gradientOpen}
        motionOpen={motionOpen}
        onChooseBackground={() => void chooseBackground()}
        onClearBackground={clearBackground}
        onToggleGradient={() => { setGradientOpen((open) => !open); setMotionOpen(false); }}
        onToggleMotion={() => { setMotionOpen((open) => !open); setGradientOpen(false); }}
        onCloseGradient={() => setGradientOpen(false)}
        onCloseMotion={() => setMotionOpen(false)}
        onSwapGradientColors={swapGradientColors}
        onUpdateGradientColor={updateGradientColor}
        onUpdateGradientStop={updateGradientStop}
        onGradientRampPointerDown={handleGradientRampPointerDown}
        onGradientRampPointerMove={handleGradientRampPointerMove}
        onGradientRampPointerEnd={handleGradientRampPointerEnd}
        setGradientMap={setGradientMap}
        setBackgroundBlur={setBackgroundBlur}
        setBackgroundTransparency={setBackgroundTransparency}
        setBackgroundImage={setBackgroundImage}
        setBackgroundTexture={setBackgroundTexture}
        setBackgroundMotion={setBackgroundMotion}
      />

      <section hidden className={`appearance-parallax-tuning${sceneEnabled ? " is-active" : ""}`} aria-labelledby="appearance-parallax-tuning-title">
        <div className="appearance-parallax-tuning-heading">
          <div><span>PARALLAX 3D ENGINE</span><strong id="appearance-parallax-tuning-title">3D 墨景参数</strong><small>{sceneEnabled ? "拖动后立即预览，场景与设置页共享同一组参数。" : "选择“一体化外观”中的 3D 墨景后启用；参数会提前保留。"}</small></div>
          <Button type="button" variant="ghost" size="sm" onClick={resetSceneTuning} title="恢复 3D 墨景默认参数"><RotateCcw size={14} />恢复默认</Button>
        </div>
        <div className="appearance-parallax-tuning-groups">
          {PARALLAX_TUNING_GROUPS.map((group) => (
            <details className="appearance-parallax-tuning-group" key={group.id} open={group.id === "motion"}>
              <summary><span><strong>{group.label}</strong><small>{group.detail}</small></span><ChevronDown aria-hidden="true" /></summary>
              <div className="appearance-parallax-tuning-content">
                {group.toggles?.map((toggle) => (
                  <div className="appearance-parallax-tuning-toggle" data-disabled={!sceneEnabled} key={toggle.key}>
                    <span><strong>{toggle.label}</strong><small>{toggle.detail}</small></span>
                    <Switch checked={sceneTuning[toggle.key]} disabled={!sceneEnabled} onCheckedChange={(checked) => updateSceneTuning(toggle.key, checked)} />
                  </div>
                ))}
                {group.sliders.map((slider) => {
                  const value = sceneTuning[slider.key];
                  return <label className="appearance-parallax-tuning-slider" data-disabled={!sceneEnabled} key={slider.key}>
                    <span><strong>{slider.label}</strong>{slider.hint && <small>{slider.hint}</small>}</span>
                    <input type="range" min={slider.min} max={slider.max} step={slider.step} value={value} disabled={!sceneEnabled} onChange={(event) => updateSceneTuning(slider.key, Number(event.target.value))} />
                    <output>{Number(value).toFixed(slider.digits)}</output>
                  </label>;
                })}
              </div>
            </details>
          ))}
        </div>
      </section>

      <div className="setting-row appearance-theme-row">
        <span><strong>主题模式</strong><small>{mode === "system" ? "跟随系统，当前为" + (resolvedMode === "dark" ? "深色" : "浅色") : "立即应用到全部工作区"}</small></span>
        <Select value={mode} onValueChange={(value) => setMode(value as AppearanceMode)}>
          <SelectTrigger className="appearance-theme-select" size="sm"><SelectValue placeholder="选择主题" /></SelectTrigger>
          <SelectContent position="popper">{MODE_OPTIONS.map(({ id, label, icon: Icon }) => <SelectItem key={id} value={id}><Icon aria-hidden="true" />{label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {isDesktop && <div className="setting-row appearance-zoom-row">
        <span><strong>界面缩放</strong><small>当前 {zoom}%</small></span>
        <div className="appearance-zoom-group" role="group" aria-label="界面缩放">
          {ZOOM_PRESETS.map((percent) => <Button key={percent} className="appearance-zoom-button" variant={zoom === percent ? "default" : "outline"} size="xs" onClick={() => setZoom(percent)}>{percent}%</Button>)}
        </div>
      </div>}
    </section>
  );
}
