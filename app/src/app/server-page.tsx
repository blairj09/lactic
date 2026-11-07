// Runs the web app's server components here, in the window. A Next page is an async function that
// loads its data and returns JSX, which may hold more async components; this resolves the whole
// tree, then renders it, and does it again whenever data changes (revalidatePath) or the route
// does. Client components in the tree render as usual and keep their state across reloads, as
// they would after a Next refresh.

import { Component, createElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";
import { DATA_CHANGED } from "~/shims/next-cache";
import { RedirectError } from "~/shims/next-navigation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PageModule = { default: (props: any) => Promise<ReactNode> | ReactNode };

const isAsync = (fn: unknown): fn is (props: unknown) => Promise<ReactNode> => typeof fn === "function" && fn.constructor?.name === "AsyncFunction";

/** Resolves async (server) components anywhere in a tree, leaving everything else for React. */
export async function resolveTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveTree));
  if (node && typeof node === "object" && "then" in node) return resolveTree(await (node as Promise<ReactNode>));
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<Record<string, unknown>>;
  if (isAsync(el.type)) return resolveTree(await el.type(el.props));
  const props = el.props ?? {};
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === "children" || isValidElement(v) || (Array.isArray(v) && v.some(isValidElement))) {
      const r = await resolveTree(v as ReactNode);
      if (r !== v) changed = true;
      next[k] = r;
    } else next[k] = v;
  }
  if (!changed) return el;
  // A list of children goes back in as arguments, as JSX passes them, so React doesn't ask for keys.
  const { children, ...rest } = next;
  const props2 = { ...rest, key: el.key ?? undefined };
  return Array.isArray(children) ? createElement(el.type, props2, ...children) : createElement(el.type, children === undefined ? props2 : { ...props2, children });
}

export function ServerPage({ load }: { load: () => Promise<PageModule> }) {
  const params = useParams();
  const [search] = useSearchParams();
  const location = useLocation();
  const [tree, setTree] = useState<ReactNode>(null);
  const [error, setError] = useState<Error | null>(null);
  const run = useRef(0);
  const routeKey = `${location.pathname}?${search.toString()}`;

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const n = ++run.current;
      try {
        const mod = await load();
        const out = await resolveTree(
          await mod.default({ params: Promise.resolve(params as Record<string, string>), searchParams: Promise.resolve(Object.fromEntries(search.entries())) }),
        );
        if (!cancelled && n === run.current) {
          setTree(out);
          setError(null);
        }
      } catch (e) {
        if (e instanceof RedirectError) return;
        console.error(e);
        if (!cancelled && n === run.current) setError(e as Error);
      }
    };
    void render();
    const onChange = () => void render();
    window.addEventListener(DATA_CHANGED, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(DATA_CHANGED, onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, load]);

  if (error) return <PageError error={error} />;
  if (tree === null) return <Loading />;
  return <Boundary key={routeKey}>{tree}</Boundary>;
}

function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6" aria-busy>
      <div className="h-7 w-40 animate-pulse rounded bg-raised" />
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-surface" />
        ))}
      </div>
    </div>
  );
}

export function PageError({ error }: { error: Error }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-xl font-semibold text-ink">Something went wrong on this page</h1>
      <p className="mt-2 text-sm text-muted">{error.message}</p>
      <button type="button" className="mt-6 h-9 rounded-md bg-primary px-4 text-sm font-medium text-on-primary" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <PageError error={this.state.error} /> : this.props.children;
  }
}
