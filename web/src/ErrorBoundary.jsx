import { Component } from 'react';

// A single bad render must never leave a blank page. The game holds a live
// seat, so the recovery path is explicit: reload, or forget the local table
// and return to the harbour.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reload = this.reload.bind(this);
    this.forget = this.forget.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the stack in the console for a developer; do not render it into the
    // page. Nothing here includes a hand or a session token.
    console.error('THE DERELICT UI CRASH', error, info?.componentStack);
  }

  reload() {
    location.reload();
  }

  forget() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('derelict.session.') || key.startsWith('derelict.hands.')) {
          localStorage.removeItem(key);
        }
      }
    } catch { /* storage may be unavailable */ }
    location.reload();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="crash-screen">
        <section className="panel narrow">
          <p className="eyebrow">THE LINK BROKE</p>
          <h2>THE TABLE WENT DARK</h2>
          <p className="muted">
            The page hit an error while drawing this table. Your seat may still be held on the
            server. Reload first; if the table stays dark, forget it and return to the harbour.
          </p>
          <p className="crash-detail"><code>{String(this.state.error?.message ?? 'unknown error').slice(0, 240)}</code></p>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={this.reload}>RELOAD THE PAGE</button>
            <button type="button" className="btn ghost" onClick={this.forget}>FORGET THIS TABLE</button>
          </div>
        </section>
      </main>
    );
  }
}
