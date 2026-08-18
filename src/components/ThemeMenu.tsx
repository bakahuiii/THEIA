import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Image,
  Monitor,
  Moon,
  Palette,
  SlidersHorizontal,
  Sparkles,
  Sun,
} from "lucide-react";
import { useAppearance, type AppearanceMode } from "@/hooks/useAppearance";
import { usePersonalization, type ThemePreset } from "@/hooks/usePersonalization";
import {
  BUCT_LAKE_PRESET,
  matchesVisualPreset,
  VISUAL_PRESET_GROUPS,
  type VisualPresetGroup,
} from "@/lib/appearance-presets";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const modeOptions: Array<{
  value: AppearanceMode;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "浅色", description: "保持明亮工作区", icon: Sun },
  { value: "dark", label: "深色", description: "降低夜间眩光", icon: Moon },
  { value: "system", label: "跟随系统", description: "自动匹配系统外观", icon: Monitor },
];

const basePresets: Array<{ id: ThemePreset; label: string; detail: string }> = [
  // These ids are kept stable for existing local preferences; the old
  // renderer exposed their visible names in the opposite order.
  { id: "midnight", label: "Classic", detail: "清透" },
  { id: "classic", label: "Midnight", detail: "沉静" },
];

export function ThemeMenu({
  onOpenAppearanceSettings,
}: {
  onOpenAppearanceSettings?: () => void;
}) {
  const { mode, setMode } = useAppearance();
  const {
    preferences,
    setPreset,
    applyVisualSettings,
    applySeasonalVisualSettings,
    setBackgroundBlur,
    setBackgroundTransparency,
    setBackgroundImage,
    setBackgroundTexture,
    setBackgroundMotion,
    setGradientMap,
  } = usePersonalization();
  const [section, setSection] = useState<"theme" | "background" | "motion">("theme");
  const hasBackground = preferences.background === "image" && Boolean(preferences.backgroundUrl);
  const duotoneActive = hasBackground && preferences.gradientMap.enabled;
  const menuPresetGroups: VisualPresetGroup[] = preferences.customVisualPresets.length
    ? [
        ...VISUAL_PRESET_GROUPS,
        {
          label: "我的预设",
          detail: "保存在这台设备上的个人外观",
          custom: true,
          presets: preferences.customVisualPresets.map((preset) => ({
            ...preset,
            detail:
              (preset.basePreset === "midnight" ? "Midnight" : "Classic") +
              " · 本地预设",
          })),
        },
      ]
    : VISUAL_PRESET_GROUPS;
  const renderPresetButtons = (group: VisualPresetGroup) => (
    <div className="appearance-menu-preset-list" role="list">
      {group.presets.map((preset) => {
        const active = matchesVisualPreset(preset, preferences);
        const seasonalPreset = preset.id === BUCT_LAKE_PRESET?.id
          ? BUCT_LAKE_PRESET
          : null;
        return <button type="button" key={preset.id} className={active ? "active" : ""} onClick={() => seasonalPreset ? applySeasonalVisualSettings(seasonalPreset, seasonalPreset.seasonalVariants) : applyVisualSettings(preset)} aria-pressed={active}>
          <span
            className={`appearance-menu-preset-swatch${preset.previewImage ? " has-preview-image" : ""}`}
            aria-hidden="true"
            style={preset.previewImage ? { backgroundImage: `url("${preset.previewImage}")` } : undefined}
          >
            {!preset.previewImage && <><i style={{ backgroundColor: preset.gradientMap.shadow }} /><i style={{ backgroundColor: preset.gradientMap.highlight }} /></>}
          </span>
          <span className="appearance-menu-preset-copy"><strong>{preset.label}</strong><small>{preset.detail}</small></span>
          {active && <Check size={14} aria-hidden="true" />}
        </button>;
      })}
    </div>
  );

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              className="appearance-menu-trigger"
              variant="ghost"
              size="icon-sm"
              aria-label="外观快捷设置"
            >
              <Palette aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">外观快捷设置</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="appearance-menu-content" align="end" sideOffset={8}>
        <div className="appearance-menu-heading">
          <span className="appearance-menu-heading-icon" aria-hidden="true">
            <Palette size={16} />
          </span>
          <span>
            <strong>外观</strong>
            <small>配色、明暗与基础主题</small>
          </span>
        </div>

        <div className="appearance-menu-layout">
          <nav className="appearance-menu-nav" aria-label="外观类别">
            <button type="button" className={section === "theme" ? "active" : ""} onClick={() => setSection("theme")}>
              <Palette size={15} /> 配色
            </button>
            <button type="button" className={section === "background" ? "active" : ""} onClick={() => setSection("background")}>
              <Image size={15} /> 背景
            </button>
            <button type="button" className={section === "motion" ? "active" : ""} onClick={() => setSection("motion")}>
              <Sparkles size={15} /> 动效
            </button>
          </nav>
          <div className="appearance-menu-pane">
            {section === "theme" && <>
              <section className="appearance-menu-section">
                <span className="appearance-menu-label">主题模式</span>
                <DropdownMenuRadioGroup className="appearance-menu-mode-grid" value={mode} onValueChange={(value) => setMode(value as AppearanceMode)}>
                  {modeOptions.map(({ value, label, icon: Icon }) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      <Icon aria-hidden="true" /><span>{label}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </section>
              <section className="appearance-menu-section">
                <span className="appearance-menu-label">基础主题</span>
                <div className="appearance-menu-base-options" role="group" aria-label="基础主题" aria-disabled={duotoneActive}>
                  {basePresets.map((preset) => {
                    const active = preferences.preset === preset.id;
                    return <button type="button" key={preset.id} className={active ? "active" : ""} onClick={() => setPreset(preset.id)} aria-pressed={active} disabled={duotoneActive}>
                      <span className={`appearance-menu-base-swatch ${preset.id}`} aria-hidden="true" />
                      <span><strong>{preset.label}</strong><small>{preset.detail}</small></span>
                      {active && <Check size={14} aria-hidden="true" />}
                    </button>;
                  })}
                </div>
                {duotoneActive && <p className="appearance-menu-disabled-note">双色映射开启时，基础主题样式由双色映射接管，此设置暂不可用。</p>}
              </section>
              <section className="appearance-menu-section">
                <span className="appearance-menu-label">配色预设</span>
                <div className="appearance-menu-preset-groups">
                  {menuPresetGroups.map((group) => (
                    <section className="appearance-menu-preset-group" key={group.label}>
                      {group.label === "古典" ? (
                        <details className="appearance-menu-collapsible">
                          <summary><span>{group.label}<small>{group.detail}</small></span><ChevronDown size={14} aria-hidden="true" /></summary>
                          {renderPresetButtons(group)}
                        </details>
                      ) : <><span>{group.label}</span>{renderPresetButtons(group)}</>}
                    </section>
                  ))}
                </div>
              </section>
            </>}
            {section === "background" && <>
              <div className={`appearance-menu-background-preview${hasBackground ? " has-image" : ""}`} style={hasBackground ? { backgroundImage: `url("${preferences.backgroundUrl}")` } : undefined}>
                <span>{hasBackground ? preferences.backgroundName || "自定义图片" : "未设置背景图片"}</span>
              </div>
              <label className="appearance-menu-slider"><span>原图模糊</span><input type="range" min="0" max="64" value={preferences.backgroundBlur} onChange={(event) => setBackgroundBlur(Number(event.target.value))} /><output>{preferences.backgroundBlur}px</output></label>
              <label className="appearance-menu-slider"><span>面板透明度</span><input type="range" min="0" max="100" value={preferences.backgroundTransparency} onChange={(event) => setBackgroundTransparency(Number(event.target.value))} /><output>{preferences.backgroundTransparency}%</output></label>
              <label className="appearance-menu-slider" data-disabled={!hasBackground}><span>图像强度</span><input type="range" min="0" max="100" disabled={!hasBackground} value={preferences.backgroundImage.opacity} onChange={(event) => setBackgroundImage({ opacity: Number(event.target.value) })} /><output>{preferences.backgroundImage.opacity}%</output></label>
              <div className="appearance-menu-switch" data-disabled={!hasBackground}><span><strong>同步界面色板</strong><small>从背景照片提取主色与辅助色，仅协调界面强调色</small></span><Switch checked={preferences.gradientMap.syncPalette} disabled={!hasBackground} onCheckedChange={(syncPalette) => setGradientMap({ syncPalette })} /></div>
            </>}
            {section === "motion" && <>
              <div className="appearance-menu-switch"><span><strong>鼠标视差</strong><small>背景随指针轻微移动</small></span><Switch checked={preferences.backgroundMotion.enabled} disabled={!hasBackground} onCheckedChange={(enabled) => setBackgroundMotion({ enabled })} /></div>
              <label className="appearance-menu-slider" data-disabled={!hasBackground || !preferences.backgroundMotion.enabled}><span>视差幅度</span><input type="range" min="0" max="120" disabled={!hasBackground || !preferences.backgroundMotion.enabled} value={preferences.backgroundMotion.intensity} onChange={(event) => setBackgroundMotion({ intensity: Number(event.target.value) })} /><output>{preferences.backgroundMotion.intensity}px</output></label>
              <div className="appearance-menu-switch"><span><strong>图片纹理</strong><small>从当前背景提取细微质感</small></span><Switch checked={preferences.backgroundTexture.enabled} disabled={!hasBackground} onCheckedChange={(enabled) => setBackgroundTexture({ enabled })} /></div>
              <label className="appearance-menu-slider" data-disabled={!hasBackground || !preferences.backgroundTexture.enabled}><span>纹理强度</span><input type="range" min="0" max="30" step="0.1" disabled={!hasBackground || !preferences.backgroundTexture.enabled} value={preferences.backgroundTexture.opacity} onChange={(event) => setBackgroundTexture({ opacity: Number(event.target.value) })} /><output>{preferences.backgroundTexture.opacity.toFixed(1)}%</output></label>
            </>}
          </div>
        </div>
        {onOpenAppearanceSettings && <DropdownMenuItem className="appearance-menu-open-settings" onSelect={onOpenAppearanceSettings}>
          <SlidersHorizontal aria-hidden="true" /><span>完整外观设置</span><ChevronRight aria-hidden="true" />
        </DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
