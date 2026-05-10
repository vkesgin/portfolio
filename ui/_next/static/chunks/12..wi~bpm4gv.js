(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,62516,e=>{"use strict";var t=e.i(12033),i=e.i(72339),a=e.i(50654);let s=[{id:"react",label:"React",icon:"⚛",note:"Next.js / Vite"},{id:"js",label:"JavaScript",icon:"🌐",note:"Vanilla / HTML"},{id:"rn",label:"React Native",icon:"📱",note:"iOS & Android"},{id:"flutter",label:"Flutter",icon:"🐦",note:"Dart / Multi"}];e.s(["default",0,function(){let[e,r]=(0,i.useState)([]),[l,n]=(0,i.useState)(!0),[o,c]=(0,i.useState)(null),[d,x]=(0,i.useState)("react"),[h,m]=(0,i.useState)(!1),[f,p]=(0,i.useState)("all"),[u,b]=(0,i.useState)(null);(0,i.useEffect)(()=>{async function e(){let e=localStorage.getItem("ui_token");if(e)try{let t=await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/auth/me",{headers:{Authorization:`Bearer ${e}`}});if(t.ok){let e=await t.json();b(e.user)}}catch(e){}}(async function(){try{let e=await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/projects?category=uilib");e.ok&&r(await e.json())}catch(e){console.error("Veri çekilemedi:",e)}finally{n(!1)}})(),e()},[]);let v=u?.plan==="PRO";u&&u.id;let g=async e=>{try{await navigator.clipboard.writeText(e),m(!0),setTimeout(()=>m(!1),2e3)}catch(e){}},w=(0,i.useMemo)(()=>{try{return o?.tags?JSON.parse(o.tags):{}}catch{return{}}},[o]),j=(0,i.useMemo)(()=>o?.image_url?.split("/").pop()??"animation.riv",[o]),y=(0,i.useMemo)(()=>o?function(e,t,i,a){let s=t.artboard||"",r=(t.stateMachines??(t.statemachine?[t.statemachine]:[]))[0]??"",l=t.inputs??[],n=l.filter(e=>0===e.type),o=r&&0===l.length,c=a.replace(/[^a-zA-Z0-9]/g,"")||"RiveComponent",d=i||"animation.riv";if("react"===e){let e=`"use client";

import { useEffect, useMemo } from "react";
import { useRive } from "@rive-app/react-canvas";

export default function ${c}() {
  const RIVE_FILE = "/rive/${d}";
`;return s&&(e+=`  const ARTBOARD = "${s}";
`),r&&(e+=`  const STATE_MACHINE = "${r}";
`),e+=`
  const { rive, RiveComponent } = useRive({
    src: RIVE_FILE,
`,s&&(e+=`    artboard: ARTBOARD,
`),r&&(e+=`    stateMachines: STATE_MACHINE,
`),e+=`    autoplay: true,
    shouldResizeCanvasToContainer: true,
  });
`,r&&n.length>0?(e+=`
  const smInputs = useMemo(
    () => rive?.stateMachineInputs(STATE_MACHINE) ?? [],
    [rive],
  );
`,n.forEach(t=>{let i=t.name.replace(/\W/g,"_").toLowerCase()+"Input";e+=`
  const ${i} = smInputs.find((i) => i.name === "${t.name}");
`;let a="fire"+t.name[0].toUpperCase()+t.name.slice(1);e+=`  const ${a} = () => { if (${i}) ${i}.fire(); };
`})):o&&(e+=`
  // Bu animasyon Rive Editor'de tanımlanmış built-in pointer listener'ları kullanıyor.
  // Hover/click olayları canvas'a native olarak iletilir — ek React kodu gerekmez.
`),e+=`
  return (
    <div className="w-full h-[420px]">
      <RiveComponent className="w-full h-full" style={{ display: "block" }} />
    </div>
`,n.length&&(e+=`    <div className="flex gap-3 mt-4">
`,n.forEach(t=>{let i="fire"+t.name[0].toUpperCase()+t.name.slice(1);e+=`      <button onClick={${i}}>Fire "${t.name}"</button>
`}),e+=`    </div>
`),e+=`  );
}
`}if("js"===e){let e=`import { Rive, Layout, Fit, Alignment } from "@rive-app/canvas";

`;return e+=`const canvas = document.getElementById("rive-canvas");

const r = new Rive({
  src: "/rive/${d}",
  canvas,
`,s&&(e+=`  artboard: "${s}",
`),r&&(e+=`  stateMachines: "${r}",
`),e+=`  autoplay: true,
  layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  onLoad: () => {
    r.resizeDrawingSurfaceToCanvas();
`,n.length?(e+=`    const inputs = r.stateMachineInputs("${r}");
`,n.forEach(t=>{e+=`    // const ${t.name.replace(/\W/g,"_")}Input = inputs.find(i => i.name === "${t.name}");
    // ${t.name.replace(/\W/g,"_")}Input?.fire();
`})):o&&(e+=`    // Native hover/click — canvas pointer events Rive tarafından otomatik işlenir
`),e+=`  }
});

/* HTML:
<canvas id="rive-canvas" width="400" height="300"></canvas>
*/
`}if("rn"===e){let e=`import Rive, { Fit } from "@rive-app/react-native";

export default function ${c}() {
  return (
    <Rive
`;return e+=`      resourceName="${d.replace(".riv","")}"
`,s&&(e+=`      artboardName="${s}"
`),r&&(e+=`      stateMachineName="${r}"
`),e+=`      fit={Fit.Contain}
      autoplay
    />
  );
}

/* Kurulum:
npm install @rive-app/react-native react-native-nitro-modules
.riv dosyasını assets/ klas\xf6r\xfcne koy */
`}if("flutter"===e){let e=`import 'package:flutter/material.dart';
import 'package:rive/rive.dart';

class ${c} extends StatelessWidget {
  const ${c}({super.key});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 400, height: 300,
      child: RiveAnimation.asset(
        'assets/${d}',
`;return s&&(e+=`        artboard: '${s}',
`),r&&(e+=`        stateMachines: ['${r}'],
`),e+=`        fit: BoxFit.contain,
      ),
    );
  }
}

/* pubspec.yaml:
dependencies:
  rive: ^0.12.0
flutter:
  assets:
    - assets/${d}
*/
`}return""}(d,w,j,o.title):"",[o,d,w,j]),k=(0,i.useMemo)(()=>e.filter(e=>{if("free"===f&&e.is_featured||"pro"===f&&!e.is_featured)return!1;if("buttons"===f){let t=(e.title+" "+e.description).toLowerCase();if(!t.includes("buton")&&!t.includes("button"))return!1}return!0}),[e,f]);return l?(0,t.jsxs)("div",{className:"py-20 text-center",children:[(0,t.jsx)("div",{className:"w-8 h-8 mx-auto mb-4 border-4 border-[#ff2b73] border-t-transparent rounded-full animate-spin"}),(0,t.jsx)("p",{className:"text-white/40",children:"Bileşenler yükleniyor..."})]}):0===e.length?(0,t.jsxs)("div",{className:"py-20 text-center border border-white/5 rounded-3xl bg-white/[0.02]",children:[(0,t.jsx)("p",{className:"text-white/40",children:"Henüz bileşen eklenmedi."}),(0,t.jsx)("p",{className:"text-white/20 text-sm mt-2",children:"Admin panelinden ilk bileşenini ekleyebilirsin."})]}):(0,t.jsxs)(t.Fragment,{children:[(0,t.jsxs)("div",{className:"flex flex-col md:flex-row items-center justify-between mb-8 gap-4",children:[(0,t.jsx)("div",{className:"flex flex-wrap items-center gap-2 p-1 rounded-2xl bg-white/5 border border-white/10 w-full md:w-auto overflow-x-auto",children:[{id:"all",label:"Tümü"},{id:"free",label:"Ücretsiz"},{id:"pro",label:"PRO"},{id:"buttons",label:"Butonlar"}].map(e=>(0,t.jsx)("button",{onClick:()=>p(e.id),className:`px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${f===e.id?"bg-[#ff2b73] text-white shadow-lg shadow-[#ff2b73]/20":"text-white/50 hover:text-white hover:bg-white/5"}`,children:e.label},e.id))}),(0,t.jsxs)("div",{className:"text-sm text-white/40",children:[k.length," bileşen gösteriliyor"]})]}),(0,t.jsx)("div",{className:"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8",children:k.map(e=>{let i={};try{e.tags&&(i=JSON.parse(e.tags))}catch(e){}let s=i.stateMachines??(i.statemachine?[i.statemachine]:[]);return(0,t.jsxs)("div",{className:"flex flex-col bg-white/[0.02] border border-white/5 rounded-3xl overflow-hidden hover:border-white/10 transition-colors",children:[(0,t.jsxs)("div",{className:"relative w-full bg-black/40",style:{height:"240px"},children:[(0,t.jsx)("div",{className:"absolute top-3 right-3 z-10 flex gap-2 pointer-events-none",children:e.is_featured?(0,t.jsx)("span",{className:"px-2 py-1 text-[10px] font-bold tracking-wider rounded bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f] text-white",children:"PRO"}):(0,t.jsx)("span",{className:"px-2 py-1 text-[10px] font-bold tracking-wider rounded bg-white/10 text-white",children:"FREE"})}),e.image_url?(0,t.jsx)("div",{style:{position:"absolute",inset:"20px",display:"flex"},children:(0,t.jsx)(a.default,{src:`https://vk-portfolio-api.vkesgin38.workers.dev${e.image_url}`,artboard:i.artboard,stateMachines:s})}):(0,t.jsx)("div",{className:"absolute inset-0 flex items-center justify-center text-white/20 text-sm",children:"Görsel Yok"})]}),(0,t.jsxs)("div",{className:"p-6 border-t border-white/5 flex-1 flex flex-col",children:[(0,t.jsx)("h3",{className:"text-lg font-semibold mb-1 hover:text-[#ff2b73] transition-colors",children:e.title}),s.length>0&&(0,t.jsx)("p",{className:"text-[11px] font-mono mb-3",children:i.inputs?.length===0?(0,t.jsx)("span",{className:"text-cyan-400",children:"✦ hover / native pointer"}):(i.inputs??[]).some(e=>0===e.type)?(0,t.jsx)("span",{className:"text-[#ff2b73]",children:"✦ tıkla → ateşle"}):(0,t.jsx)("span",{className:"text-white/30",children:"✦ animasyon"})}),(0,t.jsx)("div",{className:"mt-auto pt-4",children:(0,t.jsxs)("button",{onClick:()=>{c(e),x("react")},className:"w-full py-3 text-sm font-medium rounded-xl bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-2",children:[(0,t.jsxs)("svg",{width:"15",height:"15",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[(0,t.jsx)("rect",{x:"9",y:"9",width:"13",height:"13",rx:"2"}),(0,t.jsx)("path",{d:"M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"})]}),"Kodu Göster"]})})]})]},e.id)})}),o&&(0,t.jsxs)("div",{className:"fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6",children:[(0,t.jsx)("div",{className:"absolute inset-0 bg-black/85 backdrop-blur-sm",onClick:()=>c(null)}),(0,t.jsxs)("div",{className:"relative w-full max-w-4xl bg-[#080808] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]",children:[(0,t.jsxs)("div",{className:"flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.02] shrink-0",children:[(0,t.jsxs)("div",{className:"flex items-center gap-3",children:[(0,t.jsx)("h3",{className:"text-lg font-bold",children:o.title}),o.is_featured&&(0,t.jsx)("span",{className:"px-2 py-0.5 text-[10px] bg-[#ff2b73]/20 text-[#ff2b73] rounded-full border border-[#ff2b73]/30",children:"PRO"})]}),(0,t.jsx)("button",{onClick:()=>c(null),className:"w-9 h-9 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors",children:(0,t.jsxs)("svg",{width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[(0,t.jsx)("line",{x1:"18",y1:"6",x2:"6",y2:"18"}),(0,t.jsx)("line",{x1:"6",y1:"6",x2:"18",y2:"18"})]})})]}),(0,t.jsx)("div",{className:"flex-1 overflow-auto",children:o.is_featured&&!v?(0,t.jsxs)("div",{className:"flex flex-col lg:flex-row",style:{minHeight:"400px"},children:[(0,t.jsx)("div",{className:"lg:w-2/5 p-6 flex items-center justify-center border-b lg:border-b-0 lg:border-r border-white/5 bg-black/20",children:(0,t.jsx)("div",{className:"relative w-full max-w-xs rounded-2xl overflow-hidden border border-white/10 bg-black/40",style:{height:"240px"},children:(0,t.jsx)("div",{className:"absolute",style:{inset:"20px",display:"flex"},children:(0,t.jsx)(a.default,{src:`https://vk-portfolio-api.vkesgin38.workers.dev${o.image_url}`,artboard:w.artboard,stateMachines:w.stateMachines??(w.statemachine?[w.statemachine]:[])})})})}),(0,t.jsxs)("div",{className:"lg:w-3/5 flex flex-col items-center justify-center p-8 text-center",children:[(0,t.jsx)("div",{className:"w-16 h-16 mb-5 rounded-2xl bg-gradient-to-tr from-[#ff2b73] to-[#ff7e5f] flex items-center justify-center shadow-[0_0_40px_rgba(255,43,115,0.4)]",children:(0,t.jsxs)("svg",{width:"26",height:"26",viewBox:"0 0 24 24",fill:"none",stroke:"white",strokeWidth:"2",children:[(0,t.jsx)("rect",{x:"3",y:"11",width:"18",height:"11",rx:"2"}),(0,t.jsx)("path",{d:"M7 11V7a5 5 0 0 1 10 0v4"})]})}),(0,t.jsx)("h4",{className:"text-2xl font-bold mb-3",children:"PRO Üyelik Gerekli"}),(0,t.jsxs)("p",{className:"text-white/50 mb-2 max-w-sm",children:["Bu animasyonun kaynak kodu ve ",(0,t.jsx)("code",{className:"text-[#ff2b73]",children:".riv"})," dosyası PRO üyelere özeldir."]}),(0,t.jsx)("p",{className:"text-white/30 text-sm mb-8",children:"Önizlemeyi ücretsiz görebilirsiniz."}),(0,t.jsx)("a",{href:"/ui/pricing",className:"px-8 py-3 rounded-xl bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f] text-white font-semibold hover:scale-105 transition-transform shadow-[0_0_20px_rgba(255,43,115,0.3)]",children:"PRO'ya Yükselt & Kilidi Aç →"})]})]}):(0,t.jsxs)("div",{className:"flex flex-col lg:flex-row",style:{minHeight:"400px"},children:[(0,t.jsxs)("div",{className:"lg:w-2/5 p-6 flex flex-col items-center justify-center border-b lg:border-b-0 lg:border-r border-white/5 bg-black/20 gap-4",children:[(0,t.jsx)("div",{className:"relative w-full max-w-xs rounded-2xl overflow-hidden border border-white/10 bg-black/40",style:{height:"240px"},children:(0,t.jsx)("div",{className:"absolute",style:{inset:"20px",display:"flex"},children:(0,t.jsx)(a.default,{src:`https://vk-portfolio-api.vkesgin38.workers.dev${o.image_url}`,artboard:w.artboard,stateMachines:w.stateMachines??(w.statemachine?[w.statemachine]:[])})})}),w.inputs?.length===0&&(w.stateMachines?.length??0)>0&&(0,t.jsx)("span",{className:"text-[11px] text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 px-3 py-1.5 rounded-full",children:"✦ üzerine gel — hover aktif"}),(w.inputs??[]).some(e=>0===e.type)&&(0,t.jsx)("span",{className:"text-[11px] text-[#ff2b73] bg-[#ff2b73]/10 border border-[#ff2b73]/20 px-3 py-1.5 rounded-full",children:"✦ tıkla — ateşle"}),(0,t.jsx)("a",{href:`https://vk-portfolio-api.vkesgin38.workers.dev${o.image_url}`,download:!0,className:"w-full py-2 text-xs text-center rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white/60 border border-white/10",children:"↓ .riv dosyasını indir"})]}),(0,t.jsxs)("div",{className:"lg:w-3/5 flex flex-col",children:[(0,t.jsx)("div",{className:"flex border-b border-white/5 shrink-0",children:s.map(e=>(0,t.jsxs)("button",{onClick:()=>x(e.id),className:`flex-1 px-2 py-3 text-xs font-medium flex flex-col items-center gap-0.5 transition-colors ${d===e.id?"border-b-2 border-[#ff2b73] text-white bg-white/[0.03]":"text-white/40 hover:text-white/70"}`,children:[(0,t.jsx)("span",{className:"text-base leading-none",children:e.icon}),(0,t.jsx)("span",{className:"font-bold",children:e.label}),(0,t.jsx)("span",{className:"text-[9px] opacity-60",children:e.note})]},e.id))}),(0,t.jsxs)("div",{className:"relative flex-1",children:[(0,t.jsx)("button",{onClick:()=>g(y),className:`absolute top-3 right-3 z-10 px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${h?"bg-green-500/20 text-green-400 border border-green-500/30":"bg-white text-black hover:bg-gray-200"}`,children:h?"✓ Kopyalandı":"Kopyala"}),(0,t.jsx)("pre",{className:"p-5 pt-12 min-h-[280px] text-xs font-mono text-zinc-300 overflow-auto bg-[#050505] leading-relaxed",children:(0,t.jsx)("code",{children:y})})]}),(0,t.jsx)("div",{className:"px-5 py-3 border-t border-white/5 bg-black/20 shrink-0",children:(0,t.jsxs)("span",{className:"text-[10px] text-white/20 font-mono",children:["react"===d&&"npm install @rive-app/react-canvas","js"===d&&"npm install @rive-app/canvas","rn"===d&&"npm install @rive-app/react-native react-native-nitro-modules","flutter"===d&&"flutter pub add rive"]})})]})]})})]})]})]})}])}]);