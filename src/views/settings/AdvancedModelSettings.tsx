import { RefreshCw, Save, Server, ShieldCheck, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { bridge } from "../../bridge";
import { SecretInput } from "../../components/SecretInput";
import type { CampusState, ModelStatus } from "../../types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AdvancedModelSettings({
  state,
  status,
  onStatus,
  onMessage,
}: {
  state: CampusState;
  status: ModelStatus;
  onStatus: (status: ModelStatus) => void;
  onMessage: (message: string) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(state.settings.modelBaseUrl || "");
  const [model, setModel] = useState(state.settings.modelName || "");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>(
    status.models || state.settings.modelModels || [],
  );
  const [manualModel, setManualModel] = useState(
    Boolean(
      model &&
        !(status.models || state.settings.modelModels || []).includes(model),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [probeId, setProbeId] = useState("");
  const probeRevision = useRef(0);

  useEffect(
    () => setBaseUrl(state.settings.modelBaseUrl || ""),
    [state.settings.modelBaseUrl],
  );
  useEffect(
    () => setModel(state.settings.modelName || ""),
    [state.settings.modelName],
  );
  useEffect(() => {
    const next = status.models || state.settings.modelModels || [];
    setModels(next);
    setManualModel(
      Boolean(
        state.settings.modelName && !next.includes(state.settings.modelName),
      ),
    );
  }, [state.settings.modelModels, state.settings.modelName, status.models]);

  const detect = useCallback(
    async () => {
      const revision = ++probeRevision.current;
      if (!baseUrl.trim() || (!apiKey.trim() && !status.apiKeySaved)) return;
      setDetecting(true);
      try {
        const result = await bridge.discoverModels({ baseUrl, apiKey });
        if (revision !== probeRevision.current) return;
        setModels(result.models);
        setProbeId(result.probeId);
        setDiscoveryError(result.warning || "");
        setManualModel(Boolean(result.warning));
        setModel((current) =>
          result.models.includes(current)
            ? current
            : result.selectedModel || current,
        );
        if (result.warning) {
          onMessage(`${result.warning}；可明确输入模型 ID 后保存`);
        } else {
          onMessage(
            `检测到 ${result.models.length} 个模型，已自动选择推荐的文本模型`,
          );
        }
      } catch (error) {
        if (revision !== probeRevision.current) return;
        const message = error instanceof Error ? error.message : String(error);
        setModels([]);
        setProbeId("");
        setDiscoveryError(message);
        onMessage(message);
      } finally {
        if (revision === probeRevision.current) setDetecting(false);
      }
    },
    [apiKey, baseUrl, onMessage, status.apiKeySaved],
  );

  const invalidateProbe = () => {
    probeRevision.current += 1;
    setProbeId("");
    setDiscoveryError("");
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await bridge.saveModelConfig({
        baseUrl,
        model,
        apiKey,
        probeId,
        allowManualModel: manualModel,
      });
      onStatus(next);
      setModels(next.models || []);
      setDiscoveryError(next.warning || "");
      setApiKey("");
      setProbeId("");
      onMessage("模型服务配置已保存");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  const clearKey = async () => {
    try {
      onStatus(await bridge.clearModelApiKey());
      setModels([]);
      setProbeId("");
      onMessage("已删除本机保存的模型 API Key");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const knownSelection =
    !manualModel && models.includes(model) ? model : "__manual__";

  return (
    <section className="settings-section model-service-section">
      <div className="settings-title">
        <div className="settings-icon teal">
          <Server size={20} />
        </div>
        <div>
          <h2>模型服务</h2>
          <p>OpenAI 兼容服务。连接只会在你明确点击检测时发起。</p>
        </div>
      </div>
      <form
        className="credential-form model-service-form"
        onSubmit={(event) => void save(event)}
      >
        <label className="model-service-wide">
          <span>服务地址</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => {
              invalidateProbe();
              setBaseUrl(event.target.value);
            }}
            placeholder="https://api.example.com/v1"
            disabled={saving}
          />
        </label>
        <SecretInput
          fieldClassName="model-service-wide"
          label={
            <span>
              {status.apiKeySaved ? "新的 API Key（留空不修改）" : "API Key"}
            </span>
          }
          visibilityLabel="API Key"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(event) => {
            invalidateProbe();
            setApiKey(event.target.value);
          }}
          placeholder={
            status.apiKeySaved ? "已由当前 Windows 账户加密保存" : "sk-..."
          }
          disabled={saving}
        />
        <label className="model-service-wide">
          <span>模型 ID</span>
          {models.length > 0 && (
            <Select
              value={knownSelection}
              onValueChange={(value) => {
                if (value === "__manual__") setManualModel(true);
                else {
                  setManualModel(false);
                  setModel(value);
                }
              }}
            >
              <SelectTrigger
                className="model-service-select"
                disabled={saving || detecting}
              >
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="__manual__">手动输入模型 ID</SelectItem>
                {models.map((item) => (
                  <SelectItem value={item} key={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(manualModel || models.length === 0) && (
            <input
              value={model}
              onChange={(event) => {
                setManualModel(true);
                setModel(event.target.value);
              }}
              placeholder="输入模型 ID"
              disabled={saving}
            />
          )}
        </label>
        <p
          className={`model-discovery-status ${discoveryError ? "error" : ""}`}
        >
          {detecting
            ? "正在检测模型…"
            : discoveryError
              ? `模型列表不可用：${discoveryError}`
              : models.length
                ? `已检测到 ${models.length} 个模型`
                : probeId
                  ? "连接已检测，可以保存"
                  : "填写服务地址和 API Key 后点击检测连接"}
        </p>
        <div className="credential-security">
          <ShieldCheck size={16} />
          <span>API Key 不进入校园数据、导出文件、本地 API 或诊断日志。</span>
        </div>
        <div className="button-row">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void detect()}
            disabled={
              saving ||
              detecting ||
              !baseUrl.trim() ||
              (!apiKey.trim() && !status.apiKeySaved)
            }
          >
            <RefreshCw size={16} /> 检测连接
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={
              saving ||
              !baseUrl.trim() ||
              (!apiKey.trim() && !status.apiKeySaved) ||
              !model.trim() ||
              !probeId
            }
          >
            <Save size={16} /> 保存模型服务
          </button>
          {status.apiKeySaved && (
            <button
              className="danger-button"
              type="button"
              onClick={() => void clearKey()}
            >
              <Trash2 size={16} /> 删除 API Key
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
