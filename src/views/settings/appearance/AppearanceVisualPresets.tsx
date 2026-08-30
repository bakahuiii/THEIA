import type { CSSProperties, FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  matchesVisualPreset,
  type VisualPreset,
  type VisualPresetGroup,
} from "../../../lib/appearance-presets";
import type { Personalization } from "../../../hooks/usePersonalization";

export type AppearanceVisualPresetsProps = {
  preferences: Personalization;
  visualPresetGroups: VisualPresetGroup[];
  savePresetOpen: boolean;
  customPresetName: string;
  savePresetError: string;
  onToggleSavePreset: () => void;
  onCustomPresetNameChange: (value: string) => void;
  onSavePreset: (event: FormEvent<HTMLFormElement>) => void;
  onCancelSavePreset: () => void;
  onApplyPreset: (preset: VisualPreset) => void;
  onRemovePreset: (preset: VisualPreset) => void;
};

export function AppearanceVisualPresets({
  preferences,
  visualPresetGroups,
  savePresetOpen,
  customPresetName,
  savePresetError,
  onToggleSavePreset,
  onCustomPresetNameChange,
  onSavePreset,
  onCancelSavePreset,
  onApplyPreset,
  onRemovePreset,
}: AppearanceVisualPresetsProps) {
  return (
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
          onClick={onToggleSavePreset}
          aria-expanded={savePresetOpen}
        >
          <Plus size={15} />
          保存当前为预设
        </Button>
        <small>双色映射、界面色板与背景效果同步调整；背景来源保持不变。</small>
      </div>
      {savePresetOpen && (
        <form className="appearance-save-preset-form" onSubmit={onSavePreset}>
          <label>
            <span>
              <strong>新预设名称</strong>
              <small>保存当前双色映射、背景效果与基础主题。</small>
            </span>
            <input
              autoFocus
              maxLength={36}
              value={customPresetName}
              onChange={(event) => onCustomPresetNameChange(event.target.value)}
              placeholder="例如：夜航蓝金"
              aria-describedby={savePresetError ? "appearance-save-preset-error" : undefined}
            />
          </label>
          <div className="appearance-save-preset-actions">
            <Button type="submit" size="sm">保存预设</Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancelSavePreset}>取消</Button>
          </div>
          {savePresetError && <p id="appearance-save-preset-error" role="alert">{savePresetError}</p>}
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
                  className={["appearance-visual-preset", active ? "active" : ""].filter(Boolean).join(" ")}
                  onClick={() => onApplyPreset(preset)}
                  aria-pressed={active}
                >
                  <span
                    className={["appearance-visual-preset-swatch", preset.previewImage ? "has-preview-image" : ""].filter(Boolean).join(" ")}
                    aria-hidden="true"
                    style={{
                      "--visual-preset-shadow": preset.gradientMap.shadow,
                      "--visual-preset-highlight": preset.gradientMap.highlight,
                      "--visual-preset-shadow-stop": `${preset.gradientMap.shadowPosition}%`,
                      "--visual-preset-highlight-stop": `${preset.gradientMap.highlightPosition}%`,
                      ...(preset.previewImage ? { backgroundImage: `url("${preset.previewImage}")` } : {}),
                    } as CSSProperties}
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
                <button type="button" key={preset.id} onClick={() => onRemovePreset(preset)} title={`删除“${preset.label}”`}>
                  <Trash2 size={13} />
                  删除 {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
