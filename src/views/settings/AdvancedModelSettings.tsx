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

const DEFAULT_ADVISOR_CONFIG: CampusState["settings"]["advisorConfig"] = {
  reasoningEffort: "medium",
  responseStyle: "balanced",
  responseLength: "adaptive",
  temperature: 0.2,
  budgetLevel: "high",
};

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
  const [provider, setProvider] = useState(state.settings.modelProvider || "openai-compatible");
  const [model, setModel] = useState(state.settings.modelName || "");
  const [apiKey, setApiKey] = useState("");
  const [modelRouting, setModelRouting] = useState(state.settings.modelRouting);
  const [advisorConfig, setAdvisorConfig] = useState({
    ...DEFAULT_ADVISOR_CONFIG,
    ...(state.settings.advisorConfig || {}),
  });
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
    () => setProvider(state.settings.modelProvider || "openai-compatible"),
    [state.settings.modelProvider],
  );
  useEffect(
    () => setModel(state.settings.modelName || ""),
    [state.settings.modelName],
  );
  useEffect(
    () => setModelRouting(state.settings.modelRouting),
    [state.settings.modelRouting],
  );
  useEffect(
    () => setAdvisorConfig({ ...DEFAULT_ADVISOR_CONFIG, ...(state.settings.advisorConfig || {}) }),
    [state.settings.advisorConfig],
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
      if (!baseUrl.trim() || (!apiKey.trim() && !status.apiKeySaved && provider !== "ollama-chat")) return;
      setDetecting(true);
      try {
        const result = await bridge.discoverModels({ baseUrl, apiKey, provider });
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
    [apiKey, baseUrl, onMessage, provider, status.apiKeySaved],
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
        provider,
        model,
        apiKey,
        probeId,
        allowManualModel: manualModel,
        modelRouting,
        advisorConfig,
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
  const routeOptions = [...new Set([model, ...models].filter(Boolean))];
  const routeFields = [
    ["advisorFastModel", "快速顾问", "今日行动、通知与短解释"],
    ["advisorDeepModel", "深度顾问", "学业风险、邮件与复杂问答"],
    ["courseworkModel", "课程任务", "作业工作区现有模型流程"],
  ] as const;

  return (
    <section className="settings-section model-service-section">
      <div className="settings-title">
        <div className="settings-icon teal">
          <Server size={20} />
        </div>
        <div>
          <h2>模型服务</h2>
          <p>支持 OpenAI 兼容、Anthropic、Gemini 与 Ollama。连接只会在你明确点击检测或发送时发起。</p>
        </div>
      </div>
      <form
        className="credential-form model-service-form"
        onSubmit={(event) => void save(event)}
      >
        <label className="model-service-wide">
          <span>服务协议</span>
          <select
            value={provider}
            onChange={(event) => {
              invalidateProbe();
              setProvider(event.target.value as CampusState["settings"]["modelProvider"]);
              setModels([]);
              setManualModel(true);
            }}
            disabled={saving || detecting}
          >
            <option value="openai-compatible">OpenAI Responses</option>
            <option value="anthropic-messages">Anthropic Messages</option>
            <option value="gemini-generate-content">Gemini GenerateContent</option>
            <option value="ollama-chat">Ollama Chat</option>
          </select>
        </label>
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
              {status.apiKeySaved ? "新的 API Key，留空不修改" : "API Key"}
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
        <div className="model-service-wide grid gap-3 rounded-md border border-[var(--line)] bg-[var(--paper)] p-3">
          <span>
            <strong className="block text-xs text-[var(--ink)]">模型角色</strong>
            <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">
              留空时使用上方模型 ID；角色切换不会改变服务地址或密钥边界。
            </span>
          </span>
          <div className="grid gap-3 md:grid-cols-3">
            {routeFields.map(([field, label, description]) => (
              <label key={field} className="grid min-w-0 gap-1.5">
                <span className="text-xs font-semibold text-[var(--ink)]">{label}</span>
                <Select
                  value={modelRouting[field] || "__fallback__"}
                  onValueChange={(value) => setModelRouting((current) => ({
                    ...current,
                    [field]: value === "__fallback__" ? null : value,
                  }))}
                >
                  <SelectTrigger className="model-service-select" disabled={saving || detecting}>
                    <SelectValue placeholder="使用默认模型" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="__fallback__">使用默认模型</SelectItem>
                    {routeOptions.map((item) => (
                      <SelectItem value={item} key={`${field}-${item}`}>{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[10px] leading-4 text-[var(--muted-foreground)]">{description}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="model-service-wide grid gap-3 rounded-md border border-[var(--line)] bg-[var(--paper)] p-3">
          <span>
            <strong className="block text-xs text-[var(--ink)]">顾问偏好</strong>
            <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">
              这些选项由你控制；模型仍会根据问题决定是否读取数据和调用工具。
            </span>
          </span>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid min-w-0 gap-1.5">
              <span className="text-xs font-semibold text-[var(--ink)]">推理强度</span>
              <select
                value={advisorConfig.reasoningEffort}
                onChange={(event) => setAdvisorConfig((current) => ({ ...current, reasoningEffort: event.target.value as typeof current.reasoningEffort }))}
                disabled={saving || detecting}
              >
                <option value="none">关闭</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
                <option value="xhigh">极高</option>
                <option value="max">最大</option>
              </select>
            </label>
            <label className="grid min-w-0 gap-1.5">
              <span className="text-xs font-semibold text-[var(--ink)]">预算档位</span>
              <select
                value={advisorConfig.budgetLevel}
                onChange={(event) => setAdvisorConfig((current) => ({ ...current, budgetLevel: event.target.value as typeof current.budgetLevel }))}
                disabled={saving || detecting}
              >
                <option value="high">High - 15步/8k输出/5分钟</option>
                <option value="xhigh">XHigh - 30步/16k输出/10分钟</option>
                <option value="max">Max - 50步/32k输出/30分钟</option>
                <option value="ultra">Ultra - 无限制（实验性）</option>
              </select>
              <span className="text-[10px] leading-4 text-[var(--muted-foreground)]">
                控制 Agent 探索深度与回答长度上限；Ultra 模式允许完全自由探索。
              </span>
            </label>
            <label className="grid min-w-0 gap-1.5">
              <span className="text-xs font-semibold text-[var(--ink)]">回答风格</span>
              <select
                value={advisorConfig.responseStyle}
                onChange={(event) => setAdvisorConfig((current) => ({ ...current, responseStyle: event.target.value as typeof current.responseStyle }))}
                disabled={saving || detecting}
              >
                <option value="direct">直接给结论</option>
                <option value="balanced">结论 + 依据</option>
                <option value="detailed">详细解释与权衡</option>
              </select>
            </label>
            <label className="grid min-w-0 gap-1.5">
              <span className="text-xs font-semibold text-[var(--ink)]">回答长度</span>
              <select
                value={advisorConfig.responseLength}
                onChange={(event) => setAdvisorConfig((current) => ({
                  ...current,
                  responseLength: event.target.value as typeof current.responseLength,
                }))}
                disabled={saving || detecting}
              >
                <option value="adaptive">自适应</option>
                <option value="short">简短</option>
                <option value="standard">标准</option>
                <option value="detailed">详细</option>
              </select>
              <span className="text-[10px] leading-4 text-[var(--muted-foreground)]">
                模型会按问题和已读取的数据动态决定回答长度；这不是固定字数限制。
              </span>
            </label>
            <label className="grid min-w-0 gap-1.5">
              <span className="flex items-center justify-between text-xs font-semibold text-[var(--ink)]">
                <span>创造性</span><span>{advisorConfig.temperature.toFixed(1)}</span>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={advisorConfig.temperature}
                onChange={(event) => setAdvisorConfig((current) => ({ ...current, temperature: Number(event.target.value) }))}
                disabled={saving || detecting}
              />
              <span className="text-[10px] text-[var(--muted-foreground)]">创造性控制表达的发散程度；复杂问题是否深想由推理强度控制。</span>
            </label>
            <label className="model-service-wide">
              <span>Agent 预算档位</span>
              <select
                value={advisorConfig.budgetLevel}
                onChange={(event) => setAdvisorConfig((current) => ({ ...current, budgetLevel: event.target.value as typeof advisorConfig.budgetLevel }))}
                disabled={saving || detecting}
              >
                <option value="high">High · 15 步 / 8k 输出 / 5 分钟</option>
                <option value="xhigh">XHigh · 30 步 / 16k 输出 / 10 分钟</option>
                <option value="max">Max · 50 步 / 32k 输出 / 30 分钟</option>
                <option value="ultra">Ultra · 100 步 / 64k 输出 / 60 分钟</option>
              </select>
              <span className="text-[10px] text-[var(--muted-foreground)]">控制 Agent 探索深度和输出长度上限。Ultra 档位支持最深度的多轮验证。</span>
            </label>
          </div>
        </div>
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
              (!apiKey.trim() && !status.apiKeySaved && provider !== "ollama-chat")
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
              (!apiKey.trim() && !status.apiKeySaved && provider !== "ollama-chat") ||
              !model.trim()
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
