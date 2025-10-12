import { OutlineProvider } from "./outline/OutlineProvider";
import { OutlineView } from "./outline/OutlineView";
import { FONT_FAMILY_STACK } from "./theme/typography";

export const App = (): JSX.Element => {
  return (
    <OutlineProvider>
      <div style={{ position: "relative", minHeight: "100vh", fontFamily: FONT_FAMILY_STACK }}>
        <OutlineView paneId="outline" />
      </div>
    </OutlineProvider>
  );
};
