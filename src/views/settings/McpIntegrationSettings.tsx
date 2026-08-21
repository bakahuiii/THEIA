import { Bot, Check, CircleAlert, LoaderCircle, Plus } from "lucide-react";
import { useState } from "react";
import { bridge } from "../../bridge";

type ClientResult = Awaited<ReturnType<typeof bridge.installMcpClients>>["clients"][number];

function resultText(result: ClientResult) {
  if (result.status === "installed") return "已添加";
  if (result.status === "updated") return "已更新";
  if (result.status === "already-configured") return "已配置";
  if (result.status === "not-found") return "未检测到";
  if (result.status === "plugin-missing") return "插件不可用";
  return "配置失败";
}

export function McpIntegrationSettings({ onMessage }: { onMessage: (message: string) => void }) {
  const [installing, setInstalling] = useState(false);
  const [results, setResults] = useState<ClientResult[] | null>(null);

  const install = async () => {
    setInstalling(true);
    try {
      const outcome = await bridge.installMcpClients();
      setResults(outcome.clients);
      const changed = outcome.clients.filter((item) => item.changed).map((item) => item.client);
      if (changed.length) onMessage(`已添加 THEIA MCP：${changed.join("、")}。重启对应客户端后生效。`);
      else if (!outcome.pluginAvailable) onMessage("THEIA MCP 插件目录不可用，未修改客户端配置。");
      else onMessage("未修改客户端配置，请检查下方状态。");
    } catch (error) {
      onMessage(error instanceof Error ? `添加 MCP 失败：${error.message}` : "添加 MCP 失败。");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section className="settings-section mcp-integration-section">
      <div className="settings-title">
        <div className="settings-icon teal"><Bot size={20} /></div>
        <div>
          <h2>Codex 与 Claude Code</h2>
          <p>添加本机只读 THEIA MCP。</p>
        </div>
      </div>
      <div className="mcp-integration-actions">
        <button className="primary-button" type="button" onClick={() => void install()} disabled={installing}>
          {installing ? <LoaderCircle size={16} className="spinning" /> : <Plus size={16} />}
          {installing ? "正在添加" : "一键添加 MCP"}
        </button>
        <small>配置已存在时会更新 THEIA 项，并保留同目录备份。</small>
      </div>
      {results && (
        <div className="mcp-client-results" aria-live="polite">
          {results.map((result) => {
            const success = ["installed", "updated", "already-configured"].includes(result.status);
            return (
              <div className={`mcp-client-result ${success ? "success" : "warning"}`} key={result.client}>
                {success ? <Check size={16} /> : <CircleAlert size={16} />}
                <strong>{result.client === "codex" ? "Codex" : "Claude Code"}</strong>
                <span>{resultText(result)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
