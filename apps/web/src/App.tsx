import { useState } from "react";

/**
 * Placeholder UI for the collaborative outliner shell. Later steps will replace the sample
 * counter with the virtualised tree that reads from shared Yjs state.
 */
export const App = (): JSX.Element => {
  const [count, setCount] = useState(0);

  return (
    <main style={{ fontFamily: "Inter, sans-serif", padding: "2rem" }}>
      <h1>Thortiq Outliner</h1>
      <p>Phase 1 scaffolding is ready. Stack the next steps to build the full experience.</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Clicked {count} times
      </button>
    </main>
  );
};
