import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Startup } from "./components/Startup";
import "./index.css";

// The startup screen runs first: App's own effects open (and so create) the
// database, so App mounts only once the Startup check or Setup is done.
function Root() {
  const [ready, setReady] = useState(false);
  return ready ? <App /> : <Startup onDone={() => setReady(true)} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
