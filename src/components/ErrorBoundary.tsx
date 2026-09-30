import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onClose?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-fallback" role="alert">
        <h2>This view failed to render</h2>
        <p className="mono dim">{error.message}</p>
        {this.props.onClose && (
          <button className="error-fallback-close" onClick={this.props.onClose}>
            Back to the dashboard
          </button>
        )}
      </div>
    );
  }
}
