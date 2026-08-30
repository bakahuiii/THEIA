import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AudioWaveform, Minimize2, Pause, Play } from 'lucide-react'
import { ParallaxEditor } from './ParallaxEditor'
import {
  createParallaxSceneRuntime,
  type RuntimeControls,
} from './parallax-scene-runtime'
import {
  DEFAULT_FIGURE_DEPTHS,
  DEFAULT_TUNING,
  DEPTH_LAYER_COLORS,
  FIGURE_KEYS,
  FIGURE_NAMES,
  MODEL_NAME,
  PARALLAX_TUNING_EVENT,
  TUNING_SCHEMA_VERSION,
  TUNING_STORAGE_KEY,
  getDepthCrossings,
  getDepthOffsets,
  getEffectiveDepths,
  isFlatDepth,
  loadStoredTuning,
  saveStoredTuning,
  type DepthOffsets,
  type DepthPreset,
  type EditorTab,
  type FigureTuningKey,
  type NumericTuningKey,
  type SceneStatus,
  type TuningSettings,
} from './parallax-scene-config'
import './parallax-scene.css'

export default function App() {
  const tuningStorageKey = `${TUNING_STORAGE_KEY}:motion-lab`
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runtimeControlsRef = useRef<RuntimeControls | null>(null)
  const copyResetTimerRef = useRef<number | null>(null)
  const [tuning, setTuning] = useState<TuningSettings>(() =>
    loadStoredTuning(tuningStorageKey),
  )
  const tuningRef = useRef(tuning)
  const [figureBaseDepths, setFigureBaseDepths] = useState<readonly number[]>(
    DEFAULT_FIGURE_DEPTHS,
  )
  const [panelOpen, setPanelOpen] = useState(false)
  const [presentationMode, setPresentationMode] = useState(false)
  const [activeTab, setActiveTab] = useState<EditorTab>('depth')
  const [copied, setCopied] = useState(false)
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>('loading')
  const [depthUndo, setDepthUndo] = useState<DepthOffsets | null>(null)
  const [tourEnabled, setTourEnabled] = useState(false)
  const [tourActiveIndex, setTourActiveIndex] = useState(0)
  const [tourStepEpoch, setTourStepEpoch] = useState(0)

  const toggleTour = () => {
    const next = !tourEnabled
    setTourEnabled(next)
    runtimeControlsRef.current?.setTour(next, tourActiveIndex)
  }

  const focusTourFigure = (figureIndex: number) => {
    setTourActiveIndex(figureIndex)
    setTourEnabled(true)
    runtimeControlsRef.current?.setTour(true, figureIndex)
  }

  useEffect(() => {
    tuningRef.current = tuning
  }, [tuning])

  const commitTuning = (next: TuningSettings) => {
    tuningRef.current = next
    saveStoredTuning(next, tuningStorageKey)
    runtimeControlsRef.current?.apply(next)
    setTuning(next)
  }

  const updateTuning = (key: NumericTuningKey, value: number) => {
    if ((FIGURE_KEYS as readonly NumericTuningKey[]).includes(key)) {
      setDepthUndo(null)
    }
    commitTuning({ ...tuningRef.current, [key]: value })
  }

  const updateInkEnabled = (enabled: boolean) => {
    commitTuning({ ...tuningRef.current, inkEnabled: enabled })
  }

  const updateMotionEnabled = (enabled: boolean) => {
    commitTuning({ ...tuningRef.current, motionEnabled: enabled })
  }

  const updateSpectralEnabled = (enabled: boolean) => {
    commitTuning({ ...tuningRef.current, spectralEnabled: enabled })
  }

  const applyTuningPatch = (patch: Partial<TuningSettings>) => {
    commitTuning({ ...tuningRef.current, ...patch })
  }

  const resetDepthLayer = (key: FigureTuningKey) => {
    updateTuning(key, DEFAULT_TUNING[key])
  }

  const applyDepthPreset = (preset: DepthPreset) => {
    applyTuningPatch({ depthScale: preset.depthScale })
  }

  const resetDepthOffsets = () => {
    const currentOffsets = getDepthOffsets(tuning)
    if (FIGURE_KEYS.every((key) => Math.abs(currentOffsets[key]) < 0.0001)) return
    setDepthUndo(currentOffsets)
    applyTuningPatch({
      figure1Z: 0,
      figure2Z: 0,
      figure3Z: 0,
      figure4Z: 0,
      figure5Z: 0,
    })
  }

  const undoDepthReset = () => {
    if (!depthUndo) return
    applyTuningPatch(depthUndo)
    setDepthUndo(null)
  }

  const effectiveDepths = getEffectiveDepths(tuning, figureBaseDepths)
  const depthCrossings = isFlatDepth(tuning)
    ? []
    : getDepthCrossings(effectiveDepths)

  const resetTuning = () => {
    const next = { ...DEFAULT_TUNING }
    try {
      localStorage.removeItem(tuningStorageKey)
    } catch {
      // Reset still applies to the live editor when storage is unavailable.
    }
    setDepthUndo(null)
    tuningRef.current = next
    setTuning(next)
    runtimeControlsRef.current?.apply(next)
  }

  const copyTuning = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          { model: MODEL_NAME, version: TUNING_SCHEMA_VERSION, ...tuning },
          null,
          2,
        ),
      )
      setCopied(true)
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current)
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        copyResetTimerRef.current = null
        setCopied(false)
      }, 1200)
    } catch {
      setCopied(false)
    }
  }

  useEffect(() => {
    if (!presentationMode) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPresentationMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [presentationMode])

  useEffect(() => {
    const onExternalTuning = (event: Event) => {
      const detail = (event as CustomEvent<{
        tuning?: Partial<TuningSettings>
        source?: string
      }>).detail
      if (!detail?.tuning || detail.source === 'scene') return
      const next = { ...loadStoredTuning(tuningStorageKey), ...detail.tuning }
      tuningRef.current = next
      setTuning(next)
      runtimeControlsRef.current?.apply(next)
    }
    window.addEventListener(PARALLAX_TUNING_EVENT, onExternalTuning)
    return () => window.removeEventListener(PARALLAX_TUNING_EVENT, onExternalTuning)
  }, [tuningStorageKey])

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    return createParallaxSceneRuntime({
      host,
      canvas,
      tuningStorageKey,
      runtimeControlsRef,
      copyResetTimerRef,
      setSceneStatus,
      setFigureBaseDepths,
      setTourActiveIndex,
      setTourStepEpoch,
    })
  }, [tuningStorageKey])

  return (
    <div
      ref={hostRef}
      className={`scene${presentationMode ? ' scene--presentation' : ''}`}
      data-motion-profile="ambient"
    >
      <canvas ref={canvasRef} className="scene__canvas" aria-hidden="true" />
      {tourEnabled && sceneStatus === 'ready' && (
        <div
          className="tour-focus"
          style={
            {
              '--tour-color': DEPTH_LAYER_COLORS[tourActiveIndex],
            } as CSSProperties
          }
          aria-hidden="true"
        >
          <div className="tour-focus__lens" />
        </div>
      )}
      {presentationMode && (
        <button
          className="presentation-exit"
          type="button"
          aria-label="退出沉浸查看"
          title="退出沉浸查看"
          data-scene-ui
          onClick={() => setPresentationMode(false)}
        >
          <Minimize2 size={17} />
        </button>
      )}
      <div
        className={`tour-dock${tourEnabled ? ' is-active' : ''}`}
        style={
          {
            '--tour-color': DEPTH_LAYER_COLORS[tourActiveIndex],
          } as CSSProperties
        }
        role="toolbar"
        aria-label="五重奏景深巡游"
        data-scene-ui
      >
        <button
          className="tour-dock__toggle"
          type="button"
          aria-label={tourEnabled ? '暂停五重奏' : '开始五重奏'}
          title={tourEnabled ? '暂停五重奏' : '开始五重奏'}
          aria-pressed={tourEnabled}
          disabled={sceneStatus !== 'ready'}
          onClick={toggleTour}
        >
          {tourEnabled ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          className="tour-dock__motion"
          type="button"
          aria-label={tuning.motionEnabled ? '关闭景深共振' : '开启景深共振'}
          title={tuning.motionEnabled ? '关闭景深共振' : '开启景深共振'}
          aria-pressed={tuning.motionEnabled}
          disabled={sceneStatus !== 'ready'}
          onClick={() => updateMotionEnabled(!tuning.motionEnabled)}
        >
          <AudioWaveform size={16} />
        </button>
        <div className="tour-dock__steps" role="group" aria-label="选择人物焦点">
          {FIGURE_NAMES.map((name, index) => (
            <button
              key={name}
              className={
                tourEnabled && tourActiveIndex === index ? 'is-active' : ''
              }
              style={
                {
                  '--step-color': DEPTH_LAYER_COLORS[index],
                } as CSSProperties
              }
              type="button"
              aria-label={`聚焦人物 ${index + 1}`}
              title={`聚焦人物 ${index + 1}`}
              aria-pressed={tourEnabled && tourActiveIndex === index}
              disabled={sceneStatus !== 'ready'}
              onClick={() => focusTourFigure(index)}
            >
              {index + 1}
            </button>
          ))}
        </div>
        {tourEnabled && (
          <span
            key={`${tourActiveIndex}-${tourStepEpoch}`}
            className="tour-dock__progress"
          />
        )}
      </div>
      <ParallaxEditor
        tuning={tuning}
        panelOpen={panelOpen}
        copied={copied}
        activeTab={activeTab}
        depthUndo={depthUndo}
        effectiveDepths={effectiveDepths}
        depthCrossings={depthCrossings}
        onTogglePanel={() => setPanelOpen((open) => !open)}
        onEnterPresentation={() => setPresentationMode(true)}
        onCopyTuning={copyTuning}
        onResetTuning={resetTuning}
        onSelectTab={setActiveTab}
        onUpdateTuning={updateTuning}
        onUpdateInkEnabled={updateInkEnabled}
        onUpdateMotionEnabled={updateMotionEnabled}
        onUpdateSpectralEnabled={updateSpectralEnabled}
        onApplyDepthPreset={applyDepthPreset}
        onResetDepthOffsets={resetDepthOffsets}
        onUndoDepthReset={undoDepthReset}
        onResetDepthLayer={resetDepthLayer}
      />
    </div>
  )
}
