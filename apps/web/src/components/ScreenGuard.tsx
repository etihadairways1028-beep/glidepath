/**
 * Keeps one broken screen from taking the whole app down. If a screen fails
 * to draw, you get a card with a way back instead of a blank app that won't
 * open again (iOS reopens the Home Screen app on the screen you left it on).
 */
import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; where: string }
interface State { failed: string | null }

export class ScreenGuard extends Component<Props, State> {
  state: State = { failed: null };
  static getDerivedStateFromError(e: unknown): State { return { failed: e instanceof Error ? e.message : String(e) }; }
  componentDidCatch(e: unknown) { console.error(`[Glidepath] ${this.props.where} failed to draw`, e); }
  componentDidUpdate(prev: Props) { if (prev.where !== this.props.where && this.state.failed) this.setState({ failed: null }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="stack">
        <section className="glass strong" style={{ padding: 22 }}>
          <h2 className="h2" style={{ marginTop: 0 }}>This screen hit a problem</h2>
          <p className="muted" style={{ margin: "0 0 14px" }}>The rest of Glidepath is fine. Go back to Home, or try this screen again.</p>
          <div className="row wrap">
            <a className="btn primary" href="#/home">Go to Home</a>
            <button className="btn" onClick={() => this.setState({ failed: null })}>Try again</button>
          </div>
          <p className="faint" style={{ fontSize: 12, margin: "14px 0 0" }}>Details: {this.state.failed}</p>
        </section>
      </div>
    );
  }
}
