"use client";
import { useState, useEffect } from "react";
import { useRive } from "@rive-app/react-webgl2";

export default function TestRive() {
  const [text, setText] = useState("");
  const [val, setVal] = useState("");

  const { rive, RiveComponent } = useRive({
    src: "https://vk-portfolio-api.vkesgin38.workers.dev/uploads/component_1731278148892.riv",
    autoplay: true,
  });

  useEffect(() => {
    if (rive) {
      (window as any).riveInstance = rive;
      console.log("Rive instance ready on window.riveInstance");
    }
  }, [rive]);

  useEffect(() => {
    if (rive && text) {
      console.log("Setting text run value:", text);
      try {
        rive.setTextRunValue("ButtonMetni", text);
        rive.setTextRunValue("ButtonText", text);
        rive.setTextRunValue("TestMest", text);
      } catch (e) {
        console.error("Failed:", e);
      }
    }
  }, [rive, text]);

  return (
    <div style={{ padding: "50px" }}>
      <input type="text" value={val} onChange={e => setVal(e.target.value)} id="rive-input" />
      <button onClick={() => setText(val)} id="rive-btn">Apply</button>
      <div style={{ width: 400, height: 400, background: "#ccc" }}>
        <RiveComponent />
      </div>
    </div>
  );
}
