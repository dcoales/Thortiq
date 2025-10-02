import type { CSSProperties } from "react";

import { OutlineProvider, type OutlineProviderOptions } from "../outline/OutlineProvider";
import { OutlineView } from "../outline/OutlineView";
import {
  addEdge,
  createEphemeralPersistenceFactory,
  createEphemeralProviderFactory,
  createNode,
  createOutlineSnapshot,
  toggleEdgeCollapsed,
  type SyncManager
} from "@thortiq/client-core";
import { createMemorySessionStorageAdapter } from "@thortiq/sync-core";

interface PreviewScenario {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly options: OutlineProviderOptions;
}

const buildPreviewOptions = (
  docId: string,
  seed?: (sync: SyncManager) => void,
  config: { readonly skipDefaultSeed?: boolean } = {}
): OutlineProviderOptions => ({
  docId,
  persistenceFactory: createEphemeralPersistenceFactory(),
  providerFactory: createEphemeralProviderFactory(),
  sessionAdapter: createMemorySessionStorageAdapter(),
  autoConnect: false,
  skipDefaultSeed: config.skipDefaultSeed ?? false,
  seedOutline: seed
});

const seedDeepHierarchy = (sync: SyncManager): void => {
  const { outline, localOrigin } = sync;
  const root = createNode(outline, { text: "Product Discovery", origin: localOrigin });
  addEdge(outline, { parentNodeId: null, childNodeId: root, origin: localOrigin });

  const phases: ReadonlyArray<{
    readonly title: string;
    readonly tasks: readonly string[];
  }> = [
    {
      title: "Research",
      tasks: ["Customer interviews", "Survey analysis", "Journey mapping"]
    },
    {
      title: "Strategy",
      tasks: ["North-star goals", "Success metrics", "Risks"]
    },
    {
      title: "Execution",
      tasks: ["Backend API", "Outline UI", "QA sign-off", "Launch comms"]
    }
  ];

  phases.forEach(({ title, tasks }) => {
    const phaseNode = createNode(outline, { text: title, origin: localOrigin });
    addEdge(outline, { parentNodeId: root, childNodeId: phaseNode, origin: localOrigin });
    tasks.forEach((task) => {
      const taskNode = createNode(outline, { text: task, origin: localOrigin });
      addEdge(outline, { parentNodeId: phaseNode, childNodeId: taskNode, origin: localOrigin });
    });
  });
};

const seedCollapsedOverview = (sync: SyncManager): void => {
  const snapshot = createOutlineSnapshot(sync.outline);
  const rootEdgeId = snapshot.rootEdgeIds[0];
  if (rootEdgeId) {
    toggleEdgeCollapsed(sync.outline, rootEdgeId, true, sync.localOrigin);
  }
  const backlogNode = createNode(sync.outline, { text: "QA Backlog", origin: sync.localOrigin });
  addEdge(sync.outline, { parentNodeId: null, childNodeId: backlogNode, origin: sync.localOrigin });
  const backlogItems = ["Undo regression", "Presence indicator", "Offline smoke-test", "Docs polish"];
  backlogItems.forEach((item) => {
    const node = createNode(sync.outline, { text: item, origin: sync.localOrigin });
    addEdge(sync.outline, { parentNodeId: backlogNode, childNodeId: node, origin: sync.localOrigin });
  });
};

const previewScenarios: readonly PreviewScenario[] = [
  {
    id: "default",
    title: "Seed Outline",
    description: "Baseline document seeded during bootstrap with keyboard-friendly defaults.",
    options: buildPreviewOptions("preview-default")
  },
  {
    id: "deep",
    title: "Deep Hierarchy",
    description: "Synthetic phases illustrate nested nodes and wide branching handled by TanStack Virtual.",
    options: buildPreviewOptions("preview-deep", seedDeepHierarchy, { skipDefaultSeed: true })
  },
  {
    id: "collapsed",
    title: "Collapsed Branch",
    description: "Collapsed root keeps mirrors lightweight while a backlog column expands in parallel.",
    options: buildPreviewOptions("preview-collapsed", seedCollapsedOverview)
  }
];

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "2rem",
    background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 50%)",
    color: "#111827",
    fontFamily: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  },
  header: {
    maxWidth: "960px",
    margin: "0 auto 2rem auto",
    textAlign: "center"
  },
  title: {
    margin: 0,
    fontSize: "2.25rem",
    fontWeight: 700
  },
  subtitle: {
    marginTop: "0.75rem",
    color: "#6b7280",
    fontSize: "1rem",
    lineHeight: 1.6
  },
  grid: {
    display: "grid",
    gap: "1.5rem",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    maxWidth: "1040px",
    margin: "0 auto"
  },
  card: {
    background: "#ffffff",
    borderRadius: "1rem",
    boxShadow: "0 18px 48px -24px rgba(15, 23, 42, 0.25)",
    border: "1px solid #e2e8f0",
    padding: "1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: "1rem"
  },
  cardTitle: {
    margin: 0,
    fontSize: "1.125rem",
    fontWeight: 600
  },
  cardCopy: {
    margin: 0,
    color: "#475569",
    lineHeight: 1.5,
    fontSize: "0.95rem"
  },
  previewShell: {
    border: "1px solid #e5e7eb",
    borderRadius: "0.75rem",
    background: "#f9fafb",
    padding: "0.75rem",
    minHeight: "380px",
    display: "flex"
  },
  outlineContainer: {
    flex: 1,
    borderRadius: "0.5rem",
    overflow: "hidden",
    background: "#ffffff"
  }
};

export const PreviewApp = (): JSX.Element => {
  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Outline Showcase</h1>
        <p style={styles.subtitle}>
          Each panel boots an isolated in-memory sync manager so you can inspect keyboard flows, collapsed
          branches, and deep hierarchies without connecting to the live sync server.
        </p>
      </header>
      <div style={styles.grid}>
        {previewScenarios.map((scenario) => (
          <article key={scenario.id} style={styles.card}>
            <div>
              <h2 style={styles.cardTitle}>{scenario.title}</h2>
              <p style={styles.cardCopy}>{scenario.description}</p>
            </div>
            <div style={styles.previewShell}>
              <div style={styles.outlineContainer}>
                <OutlineProvider options={scenario.options}>
                  <OutlineView paneId="outline" />
                </OutlineProvider>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};
