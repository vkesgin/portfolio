"use client";

import { useRive, Layout, Fit, Alignment } from "@rive-app/react-webgl2";

/**
 * WebGL2 + autoBind Test
 *
 * This test uses the WebGL2 renderer which is required for ViewModels,
 * AND passes `autoBind: true` to automatically bind the ViewModel 
 * properties (which power the hover/click logic in this specific .riv file).
 */
export default function TestPage() {
  const RIVE_FILE = "https://vk-portfolio-api.vkesgin38.workers.dev/files/d1323ed4031140aa.riv";

  const { rive, RiveComponent } = useRive({
    src: RIVE_FILE,
    artboard: "Button",
    stateMachines: "State Machine 1",
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    autoBind: true, // THE MISSING LINK FOR VIEWMODELS!
  });

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: 40, background: "#050505", color: "white", minHeight: "100vh" }}>
      <h1>WebGL2 + autoBind Test</h1>
      <p>Hover should work now.</p>
      <div style={{ width: 400, height: 400, border: "1px solid rgba(255,255,255,0.1)", background: "#111", borderRadius: 12, overflow: 'hidden' }}>
        <RiveComponent style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />
      </div>
      <p>rive: {rive ? "loaded" : "loading..."}</p>
    </main>
  );
}
