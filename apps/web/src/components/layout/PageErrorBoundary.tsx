import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { resetKey: string; children: ReactNode }
interface State { error: Error | null; key: string }

/**
 * A page that crashes would otherwise unmount the whole app and leave a black screen.
 * This keeps the top bar and shows a way out; going to another page clears it.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page">
        <div className="empty-state" role="alert">
          <h2>Something went wrong on this page</h2>
          <p>The rest of the app still works.</p>
          <div className="page-actions">
            <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
            <button type="button" className="btn btn-secondary" onClick={() => window.history.back()}>Go back</button>
          </div>
        </div>
      </main>
    );
  }
}
