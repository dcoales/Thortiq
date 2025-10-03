import { OutlineProvider } from "./outline/OutlineProvider";
import { OutlineView } from "./outline/OutlineView";
import { FONT_FAMILY_STACK } from "./theme/typography";

const BUILD_ID = "build-2024-05-20-step6.3";

export const App = (): JSX.Element => {
  return (
    <OutlineProvider>
      <div style={{ position: "relative", minHeight: "100vh", fontFamily: FONT_FAMILY_STACK }}>
        <OutlineView paneId="outline" />
        <span
          style={{
            position: "fixed",
            bottom: "0.75rem",
            right: "1rem",
            fontSize: "0.75rem",
            color: "#9ca3af",
            letterSpacing: "0.05em"
          }}
        >
          {BUILD_ID}
        </span>
      </div>
    </OutlineProvider>
  );
};
