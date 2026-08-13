import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[THEIA] Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="error-boundary-fallback">
            <strong>页面出现错误</strong>
            <code>{this.state.error.message}</code>
            <button onClick={() => this.setState({ error: null })}>重试</button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
