import App from "./App";
import { ComparePage } from "./ComparePage";
import { useAppView } from "./lib/view";

export function Root() {
  const view = useAppView();
  return view === "compare" ? <ComparePage /> : <App />;
}
