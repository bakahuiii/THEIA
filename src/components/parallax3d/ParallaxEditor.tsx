import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import {
  Blend,
  Camera,
  Check,
  Copy,
  Expand,
  Layers3,
  Minus,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Undo2,
  Zap,
} from 'lucide-react'
import * as THREE from 'three'
import {
  AMBIENT_MOTION_SLIDERS,
  CAMERA_SLIDERS,
  DEPTH_LAYER_COLORS,
  DEPTH_PRESETS,
  DEPTH_SCALE_SLIDER,
  FIGURE_KEYS,
  FIGURE_SLIDERS,
  INK_SLIDERS,
  MOTION_SLIDERS,
  SPECTRAL_SLIDERS,
  type DepthOffsets,
  type EditorTab,
  type FigureTuningKey,
  type NumericTuningKey,
  type SliderDefinition,
  type TuningSettings,
} from './parallax-scene-config'

export type ParallaxEditorProps = {
  tuning: TuningSettings
  panelOpen: boolean
  copied: boolean
  activeTab: EditorTab
  depthUndo: DepthOffsets | null
  effectiveDepths: readonly number[]
  depthCrossings: readonly number[]
  onTogglePanel: () => void
  onEnterPresentation: () => void
  onCopyTuning: () => void
  onResetTuning: () => void
  onSelectTab: (tab: EditorTab) => void
  onUpdateTuning: (key: NumericTuningKey, value: number) => void
  onUpdateInkEnabled: (enabled: boolean) => void
  onUpdateMotionEnabled: (enabled: boolean) => void
  onUpdateSpectralEnabled: (enabled: boolean) => void
  onApplyDepthPreset: (preset: (typeof DEPTH_PRESETS)[number]) => void
  onResetDepthOffsets: () => void
  onUndoDepthReset: () => void
  onResetDepthLayer: (key: FigureTuningKey) => void
}

export function ParallaxEditor({
  tuning,
  panelOpen,
  copied,
  activeTab,
  depthUndo,
  effectiveDepths,
  depthCrossings,
  onTogglePanel,
  onEnterPresentation,
  onCopyTuning,
  onResetTuning,
  onSelectTab,
  onUpdateTuning,
  onUpdateInkEnabled,
  onUpdateMotionEnabled,
  onUpdateSpectralEnabled,
  onApplyDepthPreset,
  onResetDepthOffsets,
  onUndoDepthReset,
  onResetDepthLayer,
}: ParallaxEditorProps) {
  return (
    <aside
      className={`tuning-panel${panelOpen ? ' tuning-panel--open' : ''}`}
      aria-label="模型效果编辑器"
      data-scene-ui
    >
      <button
        className="tuning-panel__toggle"
        type="button"
        aria-label={panelOpen ? '收起参数' : '展开参数'}
        title={panelOpen ? '收起参数' : '展开参数'}
        onClick={onTogglePanel}
      >
        <SlidersHorizontal size={18} />
      </button>

      {panelOpen && (
        <div className="tuning-panel__body">
          <div className="tuning-panel__header">
            <div className="tuning-panel__actions">
              <button
                type="button"
                title="沉浸查看"
                aria-label="沉浸查看"
                onClick={onEnterPresentation}
              >
                <Expand size={16} />
              </button>
              <button
                type="button"
                title="复制参数"
                aria-label="复制参数"
                onClick={onCopyTuning}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
              <button
                type="button"
                title="恢复默认"
                aria-label="恢复默认"
                onClick={onResetTuning}
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>

          <div className="editor-tabs" role="tablist" aria-label="编辑器页面">
            <EditorTabButton
              id="camera"
              label="视角"
              icon={<Camera size={15} aria-hidden="true" />}
              activeTab={activeTab}
              onSelect={onSelectTab}
              onNavigate={onSelectTab}
            />
            <EditorTabButton
              id="depth"
              label="景深"
              icon={<Layers3 size={15} aria-hidden="true" />}
              activeTab={activeTab}
              onSelect={onSelectTab}
              onNavigate={onSelectTab}
            />
            <EditorTabButton
              id="ink"
              label="Ink"
              icon={<Blend size={15} aria-hidden="true" />}
              activeTab={activeTab}
              onSelect={onSelectTab}
              onNavigate={onSelectTab}
            />
            <EditorTabButton
              id="motion"
              label="动效"
              icon={<Zap size={15} aria-hidden="true" />}
              activeTab={activeTab}
              onSelect={onSelectTab}
              onNavigate={onSelectTab}
            />
            <EditorTabButton
              id="spectral"
              label="光场"
              icon={<Sparkles size={15} aria-hidden="true" />}
              activeTab={activeTab}
              onSelect={onSelectTab}
              onNavigate={onSelectTab}
            />
          </div>

          {activeTab === 'camera' && (
            <div
              id="editor-panel-camera"
              className="editor-page"
              role="tabpanel"
              aria-labelledby="editor-tab-camera"
            >
              <div className="tuning-panel__controls">
                {CAMERA_SLIDERS.map((slider) => (
                  <ParameterSlider
                    key={slider.key}
                    definition={slider}
                    value={tuning[slider.key]}
                    onChange={(value) => onUpdateTuning(slider.key, value)}
                  />
                ))}
              </div>
            </div>
          )}

          {activeTab === 'depth' && (
            <div
              id="editor-panel-depth"
              className="editor-page depth-editor"
              role="tabpanel"
              aria-labelledby="editor-tab-depth"
            >
              <div className="depth-editor__toolbar">
                <div className="depth-editor__presets" role="group" aria-label="整体景深预设">
                  {DEPTH_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      className={Math.abs(tuning.depthScale - preset.depthScale) < 0.005 ? 'is-active' : ''}
                      type="button"
                      aria-pressed={Math.abs(tuning.depthScale - preset.depthScale) < 0.005}
                      onClick={() => onApplyDepthPreset(preset)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="depth-editor__offset-actions">
                  <button
                    type="button"
                    title="全部层偏移归零"
                    onClick={onResetDepthOffsets}
                    disabled={FIGURE_KEYS.every(
                      (key) => Math.abs(tuning[key]) < 0.0001,
                    )}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    <span>层归零</span>
                  </button>
                  {depthUndo && (
                    <button type="button" title="撤销层归零" onClick={onUndoDepthReset}>
                      <Undo2 size={14} aria-hidden="true" />
                      <span>撤销</span>
                    </button>
                  )}
                </div>
              </div>

              <ParameterSlider
                definition={DEPTH_SCALE_SLIDER}
                value={tuning.depthScale}
                onChange={(value) => onUpdateTuning('depthScale', value)}
              />

              <DepthStackPreview
                depths={effectiveDepths}
                crossings={depthCrossings}
              />

              {depthCrossings.length > 0 && (
                <div className="depth-warning" role="group" aria-label="层序冲突">
                  <TriangleAlert size={14} aria-hidden="true" />
                  <button type="button" onClick={onResetDepthOffsets}>恢复层序</button>
                </div>
              )}

              <div className="depth-editor__layers">
                {FIGURE_SLIDERS.map((slider, index) => (
                  <DepthLayerControl
                    key={slider.key}
                    definition={slider}
                    index={index}
                    value={tuning[slider.key]}
                    effectiveDepth={effectiveDepths[index]}
                    onChange={(value) => onUpdateTuning(slider.key, value)}
                    onReset={() => onResetDepthLayer(slider.key)}
                  />
                ))}
              </div>
            </div>
          )}

          {activeTab === 'ink' && (
            <section
              id="editor-panel-ink"
              className="editor-page ink-controls"
              role="tabpanel"
              aria-labelledby="editor-tab-ink"
            >
              <div className="ink-controls__header">
                <label className="ink-toggle" title="Ink">
                  <input
                    type="checkbox"
                    checked={tuning.inkEnabled}
                    aria-label="启用 Ink"
                    onChange={(event) =>
                      onUpdateInkEnabled(event.currentTarget.checked)
                    }
                  />
                  <span className="ink-toggle__track" aria-hidden="true">
                    <span />
                  </span>
                </label>
              </div>
              {tuning.inkEnabled && (
                <div className="tuning-panel__controls ink-controls__sliders">
                  {INK_SLIDERS.map((slider) => (
                    <ParameterSlider
                      key={slider.key}
                      definition={slider}
                      value={tuning[slider.key]}
                      onChange={(value) => onUpdateTuning(slider.key, value)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'motion' && (
            <section
              id="editor-panel-motion"
              className="editor-page motion-controls"
              role="tabpanel"
              aria-labelledby="editor-tab-motion"
            >
              <div className="motion-controls__header">
                <label className="motion-toggle" title="景深共振">
                  <input
                    type="checkbox"
                    checked={tuning.motionEnabled}
                    aria-label="启用景深共振"
                    onChange={(event) =>
                      onUpdateMotionEnabled(event.currentTarget.checked)
                    }
                  />
                  <span className="motion-toggle__track" aria-hidden="true">
                    <span />
                  </span>
                </label>
              </div>
              <div className="motion-score" aria-hidden="true">
                {DEPTH_LAYER_COLORS.map((color, index) => (
                  <i
                    key={color}
                    style={
                      {
                        '--score-color': color,
                        '--score-index': index,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
              {tuning.motionEnabled && (
                <div className="tuning-panel__controls motion-controls__sliders">
                  {MOTION_SLIDERS.map((slider) => (
                    <ParameterSlider
                      key={slider.key}
                      definition={slider}
                      value={tuning[slider.key]}
                      onChange={(value) => onUpdateTuning(slider.key, value)}
                    />
                  ))}
                  {AMBIENT_MOTION_SLIDERS.map((slider) => (
                    <ParameterSlider
                      key={slider.key}
                      definition={slider}
                      value={tuning[slider.key]}
                      onChange={(value) => onUpdateTuning(slider.key, value)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'spectral' && (
            <section
              id="editor-panel-spectral"
              className="editor-page motion-controls spectral-controls"
              role="tabpanel"
              aria-labelledby="editor-tab-spectral"
            >
              <div className="motion-controls__header">
                <label className="motion-toggle" title="光谱大气场">
                  <input
                    type="checkbox"
                    checked={tuning.spectralEnabled}
                    aria-label="启用光谱大气场"
                    onChange={(event) =>
                      onUpdateSpectralEnabled(event.currentTarget.checked)
                    }
                  />
                  <span className="motion-toggle__track" aria-hidden="true">
                    <span />
                  </span>
                </label>
              </div>
              {tuning.spectralEnabled && (
                <div className="tuning-panel__controls motion-controls__sliders">
                  {SPECTRAL_SLIDERS.map((slider) => (
                    <ParameterSlider
                      key={slider.key}
                      definition={slider}
                      value={tuning[slider.key]}
                      onChange={(value) => onUpdateTuning(slider.key, value)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </aside>
  )
}

function EditorTabButton({
  id,
  label,
  icon,
  activeTab,
  onSelect,
  onNavigate,
}: {
  id: EditorTab
  label: string
  icon: ReactNode
  activeTab: EditorTab
  onSelect: (tab: EditorTab) => void
  onNavigate: (tab: EditorTab) => void
}) {
  const active = activeTab === id
  const tabs: readonly EditorTab[] = ['camera', 'depth', 'ink', 'motion', 'spectral']
  const navigate = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = tabs.indexOf(id)
    let nextIndex: number | null = null
    if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex + tabs.length - 1) % tabs.length
    }
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabs.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = tabs[nextIndex]
    onNavigate(nextTab)
    requestAnimationFrame(() =>
      document.getElementById(`editor-tab-${nextTab}`)?.focus(),
    )
  }
  return (
    <button
      id={`editor-tab-${id}`}
      className={active ? 'is-active' : ''}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`editor-panel-${id}`}
      tabIndex={active ? 0 : -1}
      onClick={() => onSelect(id)}
      onKeyDown={navigate}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function DepthStackPreview({
  depths,
  crossings,
}: {
  depths: readonly number[]
  crossings: readonly number[]
}) {
  const min = -1.05
  const max = 2.15

  return (
    <div
      className={`depth-stack${crossings.length ? ' depth-stack--warning' : ''}`}
      role="img"
      aria-label={`人物层近远分布：${depths
        .map((depth, index) => `F${index + 1} ${depth.toFixed(2)}`)
        .join('，')}`}
    >
      <div className="depth-stack__axis" aria-hidden="true">
        <span>远</span>
        <i />
        <span>近</span>
      </div>
      <div className="depth-stack__track">
        {depths.map((depth, index) => (
          <span
            key={FIGURE_KEYS[index]}
            className="depth-stack__marker"
            style={{
              '--depth-position': `${THREE.MathUtils.mapLinear(
                THREE.MathUtils.clamp(depth, min, max),
                min,
                max,
                4,
                96,
              )}%`,
              '--depth-color': DEPTH_LAYER_COLORS[index],
            } as CSSProperties}
            title={`${FIGURE_SLIDERS[index].label}: ${depth.toFixed(2)}`}
          >
            {index + 1}
          </span>
        ))}
      </div>
    </div>
  )
}

function DepthLayerControl({
  definition,
  index,
  value,
  effectiveDepth,
  onChange,
  onReset,
}: {
  definition: SliderDefinition<FigureTuningKey>
  index: number
  value: number
  effectiveDepth: number
  onChange: (value: number) => void
  onReset: () => void
}) {
  const [numberDraft, setNumberDraft] = useState(value.toFixed(definition.digits))
  const editingNumberRef = useRef(false)
  const cancelNumberRef = useRef(false)

  useEffect(() => {
    if (!editingNumberRef.current) {
      setNumberDraft(value.toFixed(definition.digits))
    }
  }, [definition.digits, value])

  const commitNumberDraft = () => {
    if (cancelNumberRef.current) {
      cancelNumberRef.current = false
      editingNumberRef.current = false
      setNumberDraft(value.toFixed(definition.digits))
      return
    }
    editingNumberRef.current = false
    const parsed = Number(numberDraft)
    if (!Number.isFinite(parsed)) {
      setNumberDraft(value.toFixed(definition.digits))
      return
    }
    const next = THREE.MathUtils.clamp(parsed, definition.min, definition.max)
    setNumberDraft(next.toFixed(definition.digits))
    onChange(next)
  }

  const stepBy = (direction: -1 | 1) =>
    onChange(
      THREE.MathUtils.clamp(
        Number((value + definition.step * direction).toFixed(definition.digits)),
        definition.min,
        definition.max,
      ),
    )

  return (
    <div className="depth-layer">
      <div className="depth-layer__header">
        <span
          className="depth-layer__index"
          style={{ '--depth-color': DEPTH_LAYER_COLORS[index] } as CSSProperties}
          aria-hidden="true"
        >
          {index + 1}
        </span>
        <span className="depth-layer__name">{definition.label.replace(/^F\d\s*/, '')}</span>
        <span className="depth-layer__effective" title="最终 Z 深度">
          Z {effectiveDepth.toFixed(2)}
        </span>
        <button
          className="depth-layer__reset"
          type="button"
          title={`复位${definition.label}`}
          aria-label={`复位${definition.label}`}
          disabled={Math.abs(value) < 0.0001}
          onClick={onReset}
        >
          <RotateCcw size={13} />
        </button>
      </div>
      <div className="depth-layer__controls">
        <button
          type="button"
          title={`${definition.label}后移`}
          aria-label={`${definition.label}后移`}
          onClick={() => stepBy(-1)}
        >
          <Minus size={14} />
        </button>
        <input
          className="depth-layer__range"
          style={{ '--depth-color': DEPTH_LAYER_COLORS[index] } as CSSProperties}
          type="range"
          min={definition.min}
          max={definition.max}
          step={definition.step}
          value={value}
          aria-label={`${definition.label}偏移`}
          onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        />
        <button
          type="button"
          title={`${definition.label}前移`}
          aria-label={`${definition.label}前移`}
          onClick={() => stepBy(1)}
        >
          <Plus size={14} />
        </button>
        <input
          className="depth-layer__number"
          type="text"
          inputMode="decimal"
          min={definition.min}
          max={definition.max}
          step={definition.step}
          value={numberDraft}
          aria-label={`${definition.label}精确偏移`}
          onChange={(event) => {
            editingNumberRef.current = true
            setNumberDraft(event.currentTarget.value)
          }}
          onBlur={commitNumberDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              cancelNumberRef.current = true
              event.currentTarget.blur()
            }
          }}
        />
      </div>
    </div>
  )
}

function ParameterSlider({
  definition,
  value,
  onChange,
}: {
  definition: SliderDefinition
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="parameter-slider">
      <span>{definition.label}</span>
      <input
        className="parameter-slider__number"
        type="number"
        min={definition.min}
        max={definition.max}
        step={definition.step}
        value={value.toFixed(definition.digits)}
        aria-label={`${definition.label}数值`}
        onChange={(event) => {
          if (!Number.isFinite(event.currentTarget.valueAsNumber)) return
          onChange(
            THREE.MathUtils.clamp(
              event.currentTarget.valueAsNumber,
              definition.min,
              definition.max,
            ),
          )
        }}
      />
      <input
        className="parameter-slider__range"
        type="range"
        min={definition.min}
        max={definition.max}
        step={definition.step}
        value={value}
        aria-label={`${definition.label}滑杆`}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
    </label>
  )
}
