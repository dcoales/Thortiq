import { OutlineProvider } from "./outline/OutlineProvider";
import { OutlineView } from "./outline/OutlineView";

export const App = (): JSX.Element => {
  return (
    <OutlineProvider>
      <OutlineView />
    </OutlineProvider>
  );
};
