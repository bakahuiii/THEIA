import { lexer, type Token, type Tokens } from "marked";
import { useMemo, type ReactNode } from "react";

const MARKDOWN_OPTIONS = {
  breaks: true,
  gfm: true,
};

function safeLink(value: string) {
  const href = String(value || "").trim();
  return /^(?:https?:\/\/|mailto:)/iu.test(href) ? href : null;
}

function inlineNodes(tokens: Token[] | undefined, keyPrefix: string): ReactNode[] {
  return (tokens || []).map((token, index) => inlineNode(token, `${keyPrefix}-${index}`));
}

function inlineNode(token: Token, key: string): ReactNode {
  switch (token.type) {
    case "text":
      return token.tokens?.length
        ? <span key={key}>{inlineNodes(token.tokens, key)}</span>
        : <span key={key}>{token.text}</span>;
    case "escape":
      return <span key={key}>{token.text}</span>;
    case "strong":
      return <strong key={key}>{inlineNodes(token.tokens, key)}</strong>;
    case "em":
      return <em key={key}>{inlineNodes(token.tokens, key)}</em>;
    case "del":
      return <del key={key}>{inlineNodes(token.tokens, key)}</del>;
    case "codespan":
      return <code key={key}>{token.text}</code>;
    case "br":
      return <br key={key} />;
    case "link": {
      const href = safeLink(token.href);
      const content = inlineNodes(token.tokens, key);
      return href
        ? <a key={key} href={href} target="_blank" rel="noreferrer">{content}</a>
        : <span key={key}>{content}</span>;
    }
    case "image":
      return token.text ? <span key={key} className="advisor-v2-markdown-image-alt">[图片：{token.text}]</span> : null;
    case "html":
      return null;
    default:
      return "text" in token ? token.text : null;
  }
}

function tableCell(cell: Tokens.TableCell, key: string, header: boolean) {
  const Tag = header ? "th" : "td";
  return (
    <Tag key={key} align={cell.align || undefined}>
      {inlineNodes(cell.tokens, key)}
    </Tag>
  );
}

function blockNodes(tokens: Token[], keyPrefix: string): ReactNode[] {
  return tokens.map((token, index) => blockNode(token, `${keyPrefix}-${index}`));
}

function blockNode(token: Token, key: string): ReactNode {
  switch (token.type) {
    case "space":
      return null;
    case "paragraph":
      return <p key={key}>{inlineNodes(token.tokens, key)}</p>;
    case "heading": {
      const content = inlineNodes(token.tokens, key);
      if (token.depth === 1) return <h1 key={key}>{content}</h1>;
      if (token.depth === 2) return <h2 key={key}>{content}</h2>;
      if (token.depth === 3) return <h3 key={key}>{content}</h3>;
      if (token.depth === 4) return <h4 key={key}>{content}</h4>;
      if (token.depth === 5) return <h5 key={key}>{content}</h5>;
      return <h6 key={key}>{content}</h6>;
    }
    case "blockquote": {
      const blockquote = token as Tokens.Blockquote;
      return <blockquote key={key}>{blockNodes(blockquote.tokens, key)}</blockquote>;
    }
    case "code": {
      const code = token as Tokens.Code;
      return (
        <pre key={key}>
          <code data-language={code.lang || undefined}>{code.text}</code>
        </pre>
      );
    }
    case "hr":
      return <hr key={key} />;
    case "list": {
      const list = token as Tokens.List;
      const Tag = list.ordered ? "ol" : "ul";
      const start = list.ordered && list.start !== "" && list.start !== 1 ? list.start : undefined;
      return (
        <Tag key={key} start={start}>
          {list.items.map((item, index) => (
            <li key={`${key}-item-${index}`}>
              {item.task && (
                <input
                  type="checkbox"
                  checked={Boolean(item.checked)}
                  disabled
                  readOnly
                  aria-label={item.checked ? "已完成" : "未完成"}
                />
              )}
              {blockNodes(item.tokens, `${key}-item-${index}`)}
            </li>
          ))}
        </Tag>
      );
    }
    case "table": {
      const table = token as Tokens.Table;
      return (
        <div key={key} className="advisor-v2-markdown-table-wrap">
          <table>
            <thead><tr>{table.header.map((cell, index) => tableCell(cell, `${key}-head-${index}`, true))}</tr></thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={`${key}-row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => tableCell(cell, `${key}-cell-${rowIndex}-${cellIndex}`, false))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "text":
    case "escape":
    case "strong":
    case "em":
    case "del":
    case "codespan":
    case "br":
    case "link":
    case "image":
      return inlineNode(token, key);
    case "html":
      return null;
    default:
      return "tokens" in token && Array.isArray(token.tokens)
        ? <span key={key}>{blockNodes(token.tokens, key)}</span>
        : null;
  }
}

export function AdvisorMarkdown({ source, live = false }: { source: string; live?: boolean }) {
  const nodes = useMemo(() => {
    const markdown = String(source || "");
    if (!markdown) return [];
    return blockNodes(lexer(markdown, MARKDOWN_OPTIONS), "markdown");
  }, [source]);

  return <div className={`advisor-v2-message-markdown${live ? " is-live" : ""}`}>{nodes}</div>;
}
