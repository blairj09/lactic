"use client";

import { Component } from "react";

/**
 * Keeps a coach drawer failure inside the drawer. The drawer sits in the root layout, outside the
 * pages' error boundary, so without this one error there blanks every page.
 */
export default class DrawerBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("The coach drawer failed", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <aside aria-label="Coach" className="fixed right-4 bottom-4 z-50 max-w-sm space-y-2 rounded-lg border border-line bg-surface p-4 text-sm shadow-2xl">
        <p>The coach hit a problem, often because the app was updated while this page was open.</p>
        <button type="button" className="font-medium underline underline-offset-4" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </aside>
    );
  }
}
