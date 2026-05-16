// ─── Multi-Framework Kod Üretici (Paylaşımlı) ─────────────────────────────

export interface RiveCfg {
  artboard?: string;
  stateMachines?: string[];
  statemachine?: string;
  inputs?: { name: string; type: number }[];
  viewModelProps?: { name: string; defaultValue: string; vmName?: string }[];
}

export function generateCode(
  framework: "react" | "js" | "rn" | "flutter",
  cfg: RiveCfg,
  fileName: string,
  title: string,
  customText?: string,
  customPropName?: string
) {
  const ab = cfg.artboard || "";
  const sm = (cfg.stateMachines ?? (cfg.statemachine ? [cfg.statemachine] : []))[0] ?? "";
  const inputs = cfg.inputs ?? [];
  const triggers = inputs.filter((i) => i.type === 0);
  const isNative = sm && inputs.length === 0;
  const fnName = title.replace(/[^a-zA-Z0-9]/g, "") || "RiveComponent";
  const rivFile = fileName || "animation.riv";
  const propName = customPropName || "ButtonText";

  if (framework === "react") {
    let c = `"use client";\n\nimport { useEffect, useMemo } from "react";\nimport { useRive } from "@rive-app/react-canvas";\n\nexport default function ${fnName}() {\n  const RIVE_FILE = "/rive/${rivFile}";\n`;
    if (ab) c += `  const ARTBOARD = "${ab}";\n`;
    if (sm) c += `  const STATE_MACHINE = "${sm}";\n`;
    c += `\n  const { rive, RiveComponent } = useRive({\n    src: RIVE_FILE,\n`;
    if (ab) c += `    artboard: ARTBOARD,\n`;
    if (sm) c += `    stateMachines: STATE_MACHINE,\n`;
    if (customText) {
      c += `    onLoad: () => {\n`;
      c += `      try {\n`;
      c += `        rive?.setTextRunValue("${propName}", "${customText}");\n`;
      c += `      } catch (e) {}\n`;
      c += `    },\n`;
    }
    c += `    autoplay: true,\n    shouldResizeCanvasToContainer: true,\n  });\n`;
    if (customText) {
      c += `\n  useEffect(() => {\n`;
      c += `    if (rive) {\n`;
      c += `      try { rive.setTextRunValue("${propName}", "${customText}"); } catch (e) {}\n`;
      c += `    }\n`;
      c += `  }, [rive]);\n`;
    }
    if (sm && triggers.length > 0) {
      c += `\n  const smInputs = useMemo(\n    () => rive?.stateMachineInputs(STATE_MACHINE) ?? [],\n    [rive],\n  );\n`;
      triggers.forEach((t) => {
        const v = t.name.replace(/\W/g, "_").toLowerCase() + "Input";
        c += `\n  const ${v} = smInputs.find((i) => i.name === "${t.name}");\n`;
        const fn = "fire" + t.name[0].toUpperCase() + t.name.slice(1);
        c += `  const ${fn} = () => { if (${v}) ${v}.fire(); };\n`;
      });
    } else if (isNative) {
      c += `\n  // Bu animasyon Rive Editor'de tanımlanmış built-in pointer listener'ları kullanıyor.\n  // Hover/click olayları canvas'a native olarak iletilir — ek React kodu gerekmez.\n`;
    }
    c += `\n  return (\n    <div className="w-full h-[420px]">\n      <RiveComponent className="w-full h-full" style={{ display: "block" }} />\n    </div>\n`;
    if (triggers.length) {
      c += `    <div className="flex gap-3 mt-4">\n`;
      triggers.forEach((t) => {
        const fn = "fire" + t.name[0].toUpperCase() + t.name.slice(1);
        c += `      <button onClick={${fn}}>Fire "${t.name}"</button>\n`;
      });
      c += `    </div>\n`;
    }
    c += `  );\n}\n`;
    return c;
  }

  if (framework === "js") {
    let c = `import { Rive, Layout, Fit, Alignment } from "@rive-app/canvas";\n\n`;
    c += `const canvas = document.getElementById("rive-canvas");\n\n`;
    c += `const r = new Rive({\n  src: "/rive/${rivFile}",\n  canvas,\n`;
    if (ab) c += `  artboard: "${ab}",\n`;
    if (sm) c += `  stateMachines: "${sm}",\n`;
    c += `  autoplay: true,\n  layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),\n`;
    c += `  onLoad: () => {\n    r.resizeDrawingSurfaceToCanvas();\n`;
    if (customText) {
      c += `    try { r.setTextRunValue("ButtonText", "${customText}"); } catch (e) {}\n`;
    }
    if (triggers.length) {
      c += `    const inputs = r.stateMachineInputs("${sm}");\n`;
      triggers.forEach((t) => {
        c += `    // const ${t.name.replace(/\W/g, "_")}Input = inputs.find(i => i.name === "${t.name}");\n`;
        c += `    // ${t.name.replace(/\W/g, "_")}Input?.fire();\n`;
      });
    } else if (isNative) {
      c += `    // Native hover/click — canvas pointer events Rive tarafından otomatik işlenir\n`;
    }
    c += `  }\n});\n\n/* HTML:\n<canvas id="rive-canvas" width="400" height="300"></canvas>\n*/\n`;
    return c;
  }

  if (framework === "rn") {
    let c = `import Rive, { Fit } from "@rive-app/react-native";\n\nexport default function ${fnName}() {\n  return (\n    <Rive\n`;
    c += `      resourceName="${rivFile.replace(".riv", "")}"\n`;
    if (ab) c += `      artboardName="${ab}"\n`;
    if (sm) c += `      stateMachineName="${sm}"\n`;
    c += `      fit={Fit.Contain}\n      autoplay\n    />\n  );\n}\n\n/* Kurulum:\nnpm install @rive-app/react-native react-native-nitro-modules\n.riv dosyasını assets/ klasörüne koy */\n`;
    return c;
  }

  if (framework === "flutter") {
    let c = `import 'package:flutter/material.dart';\nimport 'package:rive/rive.dart';\n\nclass ${fnName} extends StatelessWidget {\n  const ${fnName}({super.key});\n\n  @override\n  Widget build(BuildContext context) {\n    return SizedBox(\n      width: 400, height: 300,\n      child: RiveAnimation.asset(\n        'assets/${rivFile}',\n`;
    if (ab) c += `        artboard: '${ab}',\n`;
    if (sm) c += `        stateMachines: ['${sm}'],\n`;
    c += `        fit: BoxFit.contain,\n      ),\n    );\n  }\n}\n\n/* pubspec.yaml:\ndependencies:\n  rive: ^0.12.0\nflutter:\n  assets:\n    - assets/${rivFile}\n*/\n`;
    return c;
  }

  return "";
}

export const FRAMEWORKS = [
  { id: "react" as const, label: "React", icon: "⚛", note: "Next.js / Vite" },
  { id: "js" as const, label: "JavaScript", icon: "🌐", note: "Vanilla / HTML" },
  { id: "rn" as const, label: "React Native", icon: "📱", note: "iOS & Android" },
  { id: "flutter" as const, label: "Flutter", icon: "🐦", note: "Dart / Multi" },
];
