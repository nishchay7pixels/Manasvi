import { Routes, Route } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout.js";
import { Overview } from "./pages/Overview.js";
import { Activity } from "./pages/Activity.js";
import { Approvals } from "./pages/Approvals.js";
import { Sessions } from "./pages/Sessions.js";
import { Executions } from "./pages/Executions.js";
import { Channels } from "./pages/Channels.js";
import { Models } from "./pages/Models.js";
import { Tools } from "./pages/Tools.js";
import { Policy } from "./pages/Policy.js";
import { Memory } from "./pages/Memory.js";
import { Audit } from "./pages/Audit.js";
import { Traces } from "./pages/Traces.js";
import { Risk } from "./pages/Risk.js";
import { Plugins } from "./pages/Plugins.js";
import { Nodes } from "./pages/Nodes.js";
import { Settings } from "./pages/Settings.js";
import { Secrets } from "./pages/Secrets.js";
import { Tenants } from "./pages/Tenants.js";

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Overview />} />
        <Route path="activity" element={<Activity />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="executions" element={<Executions />} />
        <Route path="channels" element={<Channels />} />
        <Route path="models" element={<Models />} />
        <Route path="tools" element={<Tools />} />
        <Route path="policy" element={<Policy />} />
        <Route path="memory" element={<Memory />} />
        <Route path="audit" element={<Audit />} />
        <Route path="traces" element={<Traces />} />
        <Route path="risk" element={<Risk />} />
        <Route path="plugins" element={<Plugins />} />
        <Route path="nodes" element={<Nodes />} />
        <Route path="settings" element={<Settings />} />
        <Route path="secrets" element={<Secrets />} />
        <Route path="tenants" element={<Tenants />} />
      </Route>
    </Routes>
  );
}
