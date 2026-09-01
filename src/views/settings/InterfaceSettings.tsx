import { Bot, CheckCircle2, Clipboard, Database, LockKeyhole, Server, ShieldCheck, Wifi } from "lucide-react";
import type { ApiEndpointDescriptor, ApiStatus } from "../../types";

const CATEGORY_ORDER: ApiEndpointDescriptor["category"][] = [
  "runtime",
  "data",
  "academic",
  "public",
  "asset",
  "agent",
];

const CATEGORY_LABELS: Record<ApiEndpointDescriptor["category"], string> = {
  runtime: "运行时",
  data: "校园数据",
  academic: "教务与学业",
  public: "公开数据",
  asset: "导出与资源",
  agent: "本地顾问",
};

const MCP_TOOL_LABELS: Record<string, string> = {
  theia_get_data_health: "数据健康检查",
  theia_search_campus_records: "搜索校园记录",
  theia_search_local_facts: "搜索本地事实",
  theia_list_deadlines: "查看截止日期",
  theia_inspect_academic_progress: "查看学业进度",
  theia_get_academic_analysis: "获取学业分析",
  theia_inspect_course_analysis: "查看课程分析",
  theia_read_message: "读取一封邮件",
  theia_list_local_documents: "列出本地文档",
  theia_read_local_document: "读取本地文档",
};

function endpointGroups(endpoints: ApiEndpointDescriptor[]) {
  return CATEGORY_ORDER
    .map((category) => ({
      category,
      endpoints: endpoints.filter((endpoint) => endpoint.category === category),
    }))
    .filter((group) => group.endpoints.length > 0);
}

export function InterfaceSettings({
  status,
  onMessage,
}: {
  status: ApiStatus;
  onMessage: (message: string) => void;
}) {
  const endpoints = status.apiEndpoints || [];
  const isRunning = Boolean(status.baseUrl && status.host && status.port > 0);
  const mcp = status.mcp;
  const hostLabel = isRunning ? `${status.host}:${status.port}` : "桌面客户端启动后可用";

  const copyBaseUrl = async () => {
    if (!status.baseUrl) return;
    try {
      await navigator.clipboard.writeText(status.baseUrl);
      onMessage("本地 API 地址已复制。令牌不会显示在界面中。");
    } catch (error) {
      onMessage(error instanceof Error ? `复制失败：${error.message}` : "复制 API 地址失败。");
    }
  };

  return (
    <>
      <section className="settings-section interface-overview-section">
        <div className="settings-title">
          <div className="settings-icon teal"><Server size={20} /></div>
          <div>
            <h2>本机接口</h2>
            <p>THEIA 将规范化校园数据提供给本地工具、导出功能和受控顾问。</p>
          </div>
        </div>
        <div className={`interface-runtime-status ${isRunning ? "is-online" : "is-offline"}`}>
          <div className="interface-runtime-status-icon">
            {isRunning ? <CheckCircle2 size={19} /> : <Wifi size={19} />}
          </div>
          <div>
            <strong>{isRunning ? "本地 API 正在运行" : "本地 API 尚未连接"}</strong>
            <span>{hostLabel}</span>
          </div>
          <div className="interface-runtime-badges">
            <span>{endpoints.length} 个 HTTP 接口</span>
            <span>{mcp?.tools.length || 0} 个 MCP 工具</span>
          </div>
        </div>
        <div className="interface-fact-grid">
          <div><LockKeyhole size={16} /><span><small>监听范围</small><strong>127.0.0.1 回环地址</strong></span></div>
          <div><ShieldCheck size={16} /><span><small>请求认证</small><strong>Bearer Token</strong></span></div>
          <div><Database size={16} /><span><small>数据协议</small><strong>{status.mcp?.schema || "theia-campus-data/v1"}</strong></span></div>
        </div>
      </section>

      <section className="settings-section interface-api-section">
        <div className="settings-title">
          <div className="settings-icon amber"><Database size={20} /></div>
          <div>
            <h2>HTTP API</h2>
            <p>接口清单由本地 API 运行时提供，包含当前版本真正注册的路径。</p>
          </div>
        </div>
        <div className="api-endpoint">
          <div><small>基础地址</small><code>{status.baseUrl || "启动桌面客户端后可用"}</code></div>
          <button className="icon-button" data-tooltip="复制接口地址" aria-label="复制接口地址" disabled={!status.baseUrl} onClick={() => void copyBaseUrl()}>
            <Clipboard size={17} />
          </button>
        </div>
        <div className="interface-security-note"><ShieldCheck size={15} /><span>仅监听本机回环地址；所有请求都需要当前运行实例的令牌。令牌不会写入前端状态、导出文件或日志。</span></div>
        {endpointGroups(endpoints).map(({ category, endpoints: groupEndpoints }) => (
          <section className="interface-endpoint-group" key={category}>
            <div className="interface-endpoint-group-heading"><strong>{CATEGORY_LABELS[category]}</strong><span>{groupEndpoints.length} 个</span></div>
            <div className="interface-endpoint-list">
              {groupEndpoints.map((endpoint) => (
                <div className="interface-endpoint-row" key={`${endpoint.method}-${endpoint.path}`}>
                  <span className={`interface-method method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
                  <code>{endpoint.path}</code>
                  <strong>{endpoint.label}</strong>
                  <small>{endpoint.description}</small>
                </div>
              ))}
            </div>
          </section>
        ))}
        {!endpoints.length && <div className="interface-empty-state">当前运行环境没有提供 HTTP 接口元数据。</div>}
      </section>

      <section className="settings-section interface-mcp-section">
        <div className="settings-title">
          <div className="settings-icon teal"><Bot size={20} /></div>
          <div>
            <h2>THEIA MCP</h2>
            <p>给 Codex、Claude Code 等本地客户端使用的有界只读工具。</p>
          </div>
        </div>
        {mcp ? (
          <>
            <div className="interface-mcp-meta">
              <span><small>服务器</small><strong>{mcp.name} v{mcp.version}</strong></span>
              <span><small>协议</small><strong>{mcp.protocolVersion}</strong></span>
              <span><small>边界</small><strong>只读校园数据</strong></span>
            </div>
            <div className="interface-tool-list">
              {mcp.tools.map((tool) => (
                <div className="interface-tool-row" key={tool.name}>
                  <CheckCircle2 size={14} />
                  <span><strong>{MCP_TOOL_LABELS[tool.name] || tool.title}</strong><code>{tool.name}</code></span>
                  <small>{tool.readOnly ? "只读" : "受控"}</small>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="interface-empty-state">当前运行环境没有提供 MCP 元数据。</div>
        )}
      </section>
    </>
  );
}
