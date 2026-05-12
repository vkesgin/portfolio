(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,62516,e=>{"use strict";var t=e.i(12033),i=e.i(72339),r=e.i(50654);let s=[{id:"react",label:"React",icon:"⚛",note:"Next.js / Vite"},{id:"js",label:"JavaScript",icon:"🌐",note:"Vanilla / HTML"},{id:"rn",label:"React Native",icon:"📱",note:"iOS & Android"},{id:"flutter",label:"Flutter",icon:"🐦",note:"Dart / Multi"}];e.s(["default",0,function(){let[e,a]=(0,i.useState)([]),[l,n]=(0,i.useState)(!0),[o,d]=(0,i.useState)(null),[c,x]=(0,i.useState)("react"),[h,u]=(0,i.useState)(!1),[m,b]=(0,i.useState)("all"),[f,p]=(0,i.useState)(null),[v,g]=(0,i.useState)(null),[w,y]=(0,i.useState)(null),[j,k]=(0,i.useState)(!1),[N,R]=(0,i.useState)(""),[$,M]=(0,i.useState)(""),[T,_]=(0,i.useState)(!1);(0,i.useEffect)(()=>{async function e(){let e=localStorage.getItem("ui_token");if(e)try{let t=await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/auth/me",{headers:{Authorization:`Bearer ${e}`}});if(t.ok){let e=await t.json();p(e.user),void 0!==e.user.remaining_downloads&&g(e.user.remaining_downloads)}}catch(e){}}(async function(){try{let e=await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/projects?category=uilib");e.ok&&a(await e.json())}catch(e){console.error("Veri çekilemedi:",e)}finally{n(!1)}})(),e()},[]);let C=f?.plan==="PRO";f&&f.id;let z=async(e,t)=>{let i=localStorage.getItem("ui_token");if(!i)return!1;y(null),k(!0);try{let r=await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/download",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${i}`},body:JSON.stringify({component_id:e,download_type:t})}),s=await r.json();if(!r.ok)return y(s.error||"İndirme başarısız"),!1;return void 0!==s.remaining_downloads&&g(s.remaining_downloads),!0}catch{return y("Sunucu hatası"),!1}finally{k(!1)}},S=async(e,t)=>{if(!t||await z(t,"code"))try{await navigator.clipboard.writeText(e),u(!0),setTimeout(()=>u(!1),2e3)}catch(e){}},B=(0,i.useMemo)(()=>{try{return o?.tags?JSON.parse(o.tags):{}}catch{return{}}},[o]),A=(0,i.useMemo)(()=>o?.image_url?.split("/").pop()??"animation.riv",[o]),E=(0,i.useMemo)(()=>o?function(e,t,i,r,s){let a=t.artboard||"",l=(t.stateMachines??(t.statemachine?[t.statemachine]:[]))[0]??"",n=t.inputs??[],o=n.filter(e=>0===e.type),d=l&&0===n.length,c=r.replace(/[^a-zA-Z0-9]/g,"")||"RiveComponent",x=i||"animation.riv";if("react"===e){let e=`"use client";

import { useEffect, useMemo } from "react";
import { useRive } from "@rive-app/react-canvas";

export default function ${c}() {
  const RIVE_FILE = "/rive/${x}";
`;return a&&(e+=`  const ARTBOARD = "${a}";
`),l&&(e+=`  const STATE_MACHINE = "${l}";
`),e+=`
  const { rive, RiveComponent } = useRive({
    src: RIVE_FILE,
`,a&&(e+=`    artboard: ARTBOARD,
`),l&&(e+=`    stateMachines: STATE_MACHINE,
`),s&&(e+=`    onLoad: () => {
      try {
        rive?.setTextRunValue("ButtonText", "${s}");
      } catch (e) {}
    },
`),e+=`    autoplay: true,
    shouldResizeCanvasToContainer: true,
  });
`,s&&(e+=`
  useEffect(() => {
    if (rive) {
      try { rive.setTextRunValue("ButtonText", "${s}"); } catch (e) {}
    }
  }, [rive]);
`),l&&o.length>0?(e+=`
  const smInputs = useMemo(
    () => rive?.stateMachineInputs(STATE_MACHINE) ?? [],
    [rive],
  );
`,o.forEach(t=>{let i=t.name.replace(/\W/g,"_").toLowerCase()+"Input";e+=`
  const ${i} = smInputs.find((i) => i.name === "${t.name}");
`;let r="fire"+t.name[0].toUpperCase()+t.name.slice(1);e+=`  const ${r} = () => { if (${i}) ${i}.fire(); };
`})):d&&(e+=`
  // Bu animasyon Rive Editor'de tanımlanmış built-in pointer listener'ları kullanıyor.
  // Hover/click olayları canvas'a native olarak iletilir — ek React kodu gerekmez.
`),e+=`
  return (
    <div className="w-full h-[420px]">
      <RiveComponent className="w-full h-full" style={{ display: "block" }} />
    </div>
`,o.length&&(e+=`    <div className="flex gap-3 mt-4">
`,o.forEach(t=>{let i="fire"+t.name[0].toUpperCase()+t.name.slice(1);e+=`      <button onClick={${i}}>Fire "${t.name}"</button>
`}),e+=`    </div>
`),e+=`  );
}
`}if("js"===e){let e=`import { Rive, Layout, Fit, Alignment } from "@rive-app/canvas";

`;return e+=`const canvas = document.getElementById("rive-canvas");

const r = new Rive({
  src: "/rive/${x}",
  canvas,
`,a&&(e+=`  artboard: "${a}",
`),l&&(e+=`  stateMachines: "${l}",
`),e+=`  autoplay: true,
  layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  onLoad: () => {
    r.resizeDrawingSurfaceToCanvas();
`,s&&(e+=`    try { r.setTextRunValue("ButtonText", "${s}"); } catch (e) {}
`),o.length?(e+=`    const inputs = r.stateMachineInputs("${l}");
`,o.forEach(t=>{e+=`    // const ${t.name.replace(/\W/g,"_")}Input = inputs.find(i => i.name === "${t.name}");
    // ${t.name.replace(/\W/g,"_")}Input?.fire();
`})):d&&(e+=`    // Native hover/click — canvas pointer events Rive tarafından otomatik işlenir
`),e+=`  }
});

/* HTML:
<canvas id="rive-canvas" width="400" height="300"></canvas>
*/
`}if("rn"===e){let e=`import Rive, { Fit } from "@rive-app/react-native";

export default function ${c}() {
  return (
    <Rive
`;return e+=`      resourceName="${x.replace(".riv","")}"
`,a&&(e+=`      artboardName="${a}"
`),l&&(e+=`      stateMachineName="${l}"
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
        'assets/${x}',
`;return a&&(e+=`        artboard: '${a}',
`),l&&(e+=`        stateMachines: ['${l}'],
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
    - assets/${x}
*/
`}return""}(c,B,A,o.title,N):"",[o,c,B,A,N]),O=(0,i.useMemo)(()=>e.filter(e=>{if("free"===m&&e.is_featured||"pro"===m&&!e.is_featured)return!1;if("buttons"===m){let t=(e.title+" "+e.description).toLowerCase();if(!t.includes("buton")&&!t.includes("button"))return!1}return!0}),[e,m]);return l?(0,t.jsxs)("div",{className:"py-20 text-center",children:[(0,t.jsx)("div",{className:"w-8 h-8 mx-auto mb-4 border-4 border-[#ff2b73] border-t-transparent rounded-full animate-spin"}),(0,t.jsx)("p",{className:"text-white/40",children:"Bileşenler yükleniyor..."})]}):0===e.length?(0,t.jsxs)("div",{className:"py-20 text-center border border-white/5 rounded-3xl bg-white/[0.02]",children:[(0,t.jsx)("p",{className:"text-white/40",children:"Henüz bileşen eklenmedi."}),(0,t.jsx)("p",{className:"text-white/20 text-sm mt-2",children:"Admin panelinden ilk bileşenini ekleyebilirsin."})]}):(0,t.jsxs)(t.Fragment,{children:[(0,t.jsxs)("div",{className:"flex flex-col md:flex-row items-center justify-between mb-8 gap-4",children:[(0,t.jsx)("div",{className:"flex flex-wrap items-center gap-2 p-1 rounded-2xl bg-white/5 border border-white/10 w-full md:w-auto overflow-x-auto",children:[{id:"all",label:"Tümü"},{id:"free",label:"Ücretsiz"},{id:"pro",label:"PRO"},{id:"buttons",label:"Butonlar"}].map(e=>(0,t.jsx)("button",{onClick:()=>b(e.id),className:`px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${m===e.id?"bg-[#ff2b73] text-white shadow-lg shadow-[#ff2b73]/20":"text-white/50 hover:text-white hover:bg-white/5"}`,children:e.label},e.id))}),(0,t.jsxs)("div",{className:"text-sm text-white/40",children:[O.length," bileşen gösteriliyor"]})]}),(0,t.jsx)("div",{className:"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8",children:O.map(e=>{let i={};try{e.tags&&(i=JSON.parse(e.tags))}catch(e){}let s=i.stateMachines??(i.statemachine?[i.statemachine]:[]);return(0,t.jsxs)("div",{className:"flex flex-col bg-white/[0.02] border border-white/5 rounded-3xl overflow-hidden hover:border-white/10 transition-colors",children:[(0,t.jsxs)("div",{className:"relative w-full bg-black/40",style:{height:"240px"},children:[(0,t.jsx)("div",{className:"absolute top-3 right-3 z-10 flex gap-2 pointer-events-none",children:e.is_featured?(0,t.jsx)("span",{className:"px-2 py-1 text-[10px] font-bold tracking-wider rounded bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f] text-white",children:"PRO"}):(0,t.jsx)("span",{className:"px-2 py-1 text-[10px] font-bold tracking-wider rounded bg-white/10 text-white",children:"FREE"})}),e.image_url?(0,t.jsx)("div",{style:{position:"absolute",inset:"20px",display:"flex"},children:(0,t.jsx)(r.default,{src:`https://vk-portfolio-api.vkesgin38.workers.dev${e.image_url}`,artboard:i.artboard,stateMachines:s})}):(0,t.jsx)("div",{className:"absolute inset-0 flex items-center justify-center text-white/20 text-sm",children:"Görsel Yok"})]}),(0,t.jsxs)("div",{className:"p-6 border-t border-white/5 flex-1 flex flex-col",children:[(0,t.jsx)("h3",{className:"text-lg font-semibold mb-1 hover:text-[#ff2b73] transition-colors",children:e.title}),s.length>0&&(0,t.jsx)("p",{className:"text-[11px] font-mono mb-3",children:i.inputs?.length===0?(0,t.jsx)("span",{className:"text-cyan-400",children:"✦ hover / native pointer"}):(i.inputs??[]).some(e=>0===e.type)?(0,t.jsx)("span",{className:"text-[#ff2b73]",children:"✦ tıkla → ateşle"}):(0,t.jsx)("span",{className:"text-white/30",children:"✦ animasyon"})}),(0,t.jsx)("div",{className:"mt-auto pt-4",children:(0,t.jsxs)("button",{onClick:()=>{d(e),x("react")},className:"w-full py-3 text-sm font-medium rounded-xl bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-2",children:[(0,t.jsxs)("svg",{width:"15",height:"15",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[(0,t.jsx)("rect",{x:"9",y:"9",width:"13",height:"13",rx:"2"}),(0,t.jsx)("path",{d:"M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"})]}),"Kodu Göster"]})})]})]},e.id)})}),o&&(0,t.jsxs)("div",{className:"fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6",children:[(0,t.jsx)("div",{className:"absolute inset-0 bg-black/85 backdrop-blur-sm",onClick:()=>{d(null),R(""),M("")}}),(0,t.jsxs)("div",{className:"relative w-full max-w-5xl bg-[#080808] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]",children:[(0,t.jsxs)("div",{className:"flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.02] shrink-0",children:[(0,t.jsxs)("div",{className:"flex items-center gap-3",children:[(0,t.jsx)("h3",{className:"text-lg font-bold",children:o.title}),o.is_featured&&(0,t.jsx)("span",{className:"px-2 py-0.5 text-[10px] bg-[#ff2b73]/20 text-[#ff2b73] rounded-full border border-[#ff2b73]/30",children:"PRO"})]}),(0,t.jsx)("button",{onClick:()=>{d(null),R(""),M("")},className:"w-9 h-9 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors",children:(0,t.jsxs)("svg",{width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[(0,t.jsx)("line",{x1:"18",y1:"6",x2:"6",y2:"18"}),(0,t.jsx)("line",{x1:"6",y1:"6",x2:"18",y2:"18"})]})})]}),(0,t.jsx)("div",{className:"flex-1 overflow-auto",children:f?o.is_featured&&!C?(0,t.jsxs)("div",{className:"flex flex-col lg:flex-row",style:{minHeight:"400px"},children:[(0,t.jsx)("div",{className:"lg:w-2/5 p-6 flex items-center justify-center border-b lg:border-b-0 lg:border-r border-white/5 bg-black/20",children:(0,t.jsx)("div",{className:"relative w-full max-w-xs rounded-2xl overflow-hidden border border-white/10 bg-black/40",style:{height:"240px"},children:(0,t.jsx)("div",{className:"absolute",style:{inset:"20px",display:"flex"},children:(0,t.jsx)(r.default,{src:`https://vk-portfolio-api.vkesgin38.workers.dev${o.image_url}`,artboard:B.artboard,stateMachines:B.stateMachines??(B.statemachine?[B.statemachine]:[])})})})}),(0,t.jsxs)("div",{className:"lg:w-3/5 flex flex-col items-center justify-center p-8 text-center",children:[(0,t.jsx)("div",{className:"w-16 h-16 mb-5 rounded-2xl bg-gradient-to-tr from-[#ff2b73] to-[#ff7e5f] flex items-center justify-center shadow-[0_0_40px_rgba(255,43,115,0.4)]",children:(0,t.jsxs)("svg",{width:"26",height:"26",viewBox:"0 0 24 24",fill:"none",stroke:"white",strokeWidth:"2",children:[(0,t.jsx)("rect",{x:"3",y:"11",width:"18",height:"11",rx:"2"}),(0,t.jsx)("path",{d:"M7 11V7a5 5 0 0 1 10 0v4"})]})}),(0,t.jsx)("h4",{className:"text-2xl font-bold mb-3",children:"PRO Üyelik Gerekli"}),(0,t.jsxs)("p",{className:"text-white/50 mb-2 max-w-sm",children:["Bu animasyonun kaynak kodu ve ",(0,t.jsx)("code",{className:"text-[#ff2b73]",children:".riv"})," dosyası PRO üyelere özeldir."]}),(0,t.jsx)("p",{className:"text-white/30 text-sm mb-8",children:"Önizlemeyi ücretsiz görebilirsiniz."}),(0,t.jsx)("a",{href:"/ui/pricing",className:"px-8 py-3 rounded-xl bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f] text-white font-semibold hover:scale-105 transition-transform shadow-[0_0_20px_rgba(255,43,115,0.3)]",children:"PRO'ya Yükselt & Kilidi Aç →"})]})]}):(0,t.jsxs)("div",{className:"flex flex-col lg:flex-row",style:{minHeight:"500px"},children:[(0,t.jsxs)("div",{className:"lg:w-1/2 p-6 flex flex-col items-center justify-center border-b lg:border-b-0 lg:border-r border-white/5 bg-black/20 gap-4",children:[(0,t.jsxs)("div",{className:"relative w-full max-w-md rounded-2xl overflow-hidden border border-white/10 bg-black/40 shadow-[0_0_40px_rgba(255,43,115,0.05)]",style:{height:"300px"},children:[(0,t.jsx)("div",{className:"absolute",style:{inset:"20px",display:"flex"},children:(0,t.jsx)(r.default,{src:`https://vk-portfolio-api.vkesgin38.workers.dev${o.image_url}`,artboard:B.artboard,stateMachines:B.stateMachines??(B.statemachine?[B.statemachine]:[]),texts:$?{ButtonText:$,Text:$,Label:$,Title:$,"Text 1":$,Yazi:$,Metin:$,Run:$,TextRun:$,"Text Run 1":$,"Text Run":$}:void 0})}),(0,t.jsx)("button",{onClick:()=>_(!0),className:"absolute bottom-3 right-3 p-2 bg-black/60 hover:bg-[#ff2b73] text-white rounded-xl backdrop-blur-md transition-all border border-white/10 group",title:"Büyük Ekranda İncele",children:(0,t.jsx)("svg",{width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",className:"group-hover:scale-110 transition-transform",children:(0,t.jsx)("path",{d:"M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"})})})]}),(0,t.jsxs)("div",{className:"w-full max-w-md bg-white/[0.02] border border-white/10 rounded-xl p-4 mt-2",children:[(0,t.jsx)("label",{className:"block text-xs font-semibold text-white/50 mb-2",children:"Buton/Animasyon Yazısı"}),(0,t.jsxs)("div",{className:"flex gap-2",children:[(0,t.jsx)("input",{type:"text",value:N,onChange:e=>R(e.target.value),onKeyDown:e=>"Enter"===e.key&&M(N),placeholder:"Örn: Satın Al",className:"flex-1 bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-[#ff2b73]/50 transition-colors"}),(0,t.jsx)("button",{onClick:()=>M(N),className:"px-4 py-2 bg-white/10 hover:bg-[#ff2b73] text-white text-sm font-medium rounded-lg transition-colors border border-white/10",children:"Önizle"})]})]}),B.inputs?.length===0&&(B.stateMachines?.length??0)>0&&(0,t.jsx)("span",{className:"text-[11px] text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 px-3 py-1.5 rounded-full",children:"✦ üzerine gel — hover aktif"}),(B.inputs??[]).some(e=>0===e.type)&&(0,t.jsx)("span",{className:"text-[11px] text-[#ff2b73] bg-[#ff2b73]/10 border border-[#ff2b73]/20 px-3 py-1.5 rounded-full",children:"✦ tıkla — ateşle"}),null===v||0!==v||C?(0,t.jsx)("button",{disabled:j,onClick:async()=>{await z(o.id,"riv")&&window.open(`https://vk-portfolio-api.vkesgin38.workers.dev${o.image_url}`,"_blank")},className:"w-full py-2 text-xs text-center rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white/60 border border-white/10 disabled:opacity-50",children:j?"İşleniyor...":`↓ .riv dosyasını indir ${C?"":`(Kalan: ${v??"?"}/5)`}`}):(0,t.jsxs)("div",{className:"w-full py-3 text-xs text-center rounded-lg bg-red-500/10 border border-red-500/20 text-red-400",children:["Aylık indirme limitiniz doldu (0/5)",(0,t.jsx)("a",{href:"/ui/pricing",className:"block mt-1 text-[#ff2b73] hover:underline",children:"PRO'ya geç →"})]}),w&&(0,t.jsx)("div",{className:"w-full py-2 text-xs text-center rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 mt-2",children:w})]}),(0,t.jsxs)("div",{className:"lg:w-1/2 flex flex-col",children:[(0,t.jsx)("div",{className:"flex border-b border-white/5 shrink-0",children:s.map(e=>(0,t.jsxs)("button",{onClick:()=>x(e.id),className:`flex-1 px-2 py-3 text-xs font-medium flex flex-col items-center gap-0.5 transition-colors ${c===e.id?"border-b-2 border-[#ff2b73] text-white bg-white/[0.03]":"text-white/40 hover:text-white/70"}`,children:[(0,t.jsx)("span",{className:"text-base leading-none",children:e.icon}),(0,t.jsx)("span",{className:"font-bold",children:e.label}),(0,t.jsx)("span",{className:"text-[9px] opacity-60",children:e.note})]},e.id))}),(0,t.jsxs)("div",{className:"relative flex-1",children:[(0,t.jsx)("button",{disabled:j,onClick:()=>S(E,o?.id),className:`absolute top-3 right-3 z-10 px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${h?"bg-green-500/20 text-green-400 border border-green-500/30":"bg-white text-black hover:bg-gray-200"} disabled:opacity-50`,children:j?"...":h?"✓ Kopyalandı":"Kopyala"}),(0,t.jsx)("pre",{className:"p-5 pt-12 min-h-[280px] text-xs font-mono text-zinc-300 overflow-auto bg-[#050505] leading-relaxed",children:(0,t.jsx)("code",{children:E})})]}),(0,t.jsx)("div",{className:"px-5 py-3 border-t border-white/5 bg-black/20 shrink-0",children:(0,t.jsxs)("span",{className:"text-[10px] text-white/20 font-mono",children:["react"===c&&"npm install @rive-app/react-canvas","js"===c&&"npm install @rive-app/canvas","rn"===c&&"npm install @rive-app/react-native react-native-nitro-modules","flutter"===c&&"flutter pub add rive"]})})]})]}):(0,t.jsxs)("div",{className:"flex flex-col lg:flex-row",style:{minHeight:"400px"},children:[(0,t.jsx)("div",{className:"lg:w-2/5 p-6 flex items-center justify-center border-b lg:border-b-0 lg:border-r border-white/5 bg-black/20",children:(0,t.jsx)("div",{className:"relative w-full max-w-xs rounded-2xl overflow-hidden border border-white/10 bg-black/40",style:{height:"240px"},children:(0,t.jsx)("div",{className:"absolute",style:{inset:"20px",display:"flex"},children:(0,t.jsx)(r.default,{src:`https://vk-portfolio-api.vkesgin38.workers.dev${o.image_url}`,artboard:B.artboard,stateMachines:B.stateMachines??(B.statemachine?[B.statemachine]:[])})})})}),(0,t.jsxs)("div",{className:"lg:w-3/5 flex flex-col items-center justify-center p-8 text-center",children:[(0,t.jsx)("div",{className:"w-16 h-16 mb-5 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10",children:(0,t.jsx)("svg",{width:"26",height:"26",viewBox:"0 0 24 24",fill:"none",stroke:"white",strokeWidth:"2",children:(0,t.jsx)("path",{d:"M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"})})}),(0,t.jsx)("h4",{className:"text-2xl font-bold mb-3",children:"Giriş Yapmanız Gerekiyor"}),(0,t.jsxs)("p",{className:"text-white/50 mb-2 max-w-sm",children:["Bu animasyonun kaynak koduna ve ",(0,t.jsx)("code",{className:"text-[#ff2b73]",children:".riv"})," dosyasına erişmek için ücretsiz üye olmalısınız."]}),(0,t.jsx)("p",{className:"text-white/30 text-sm mb-8",children:"Önizlemeyi ücretsiz görebilirsiniz."}),(0,t.jsxs)("div",{className:"flex gap-4",children:[(0,t.jsx)("a",{href:"/ui/login",className:"px-6 py-3 rounded-xl bg-white text-black font-semibold hover:bg-gray-200 transition-colors",children:"Giriş Yap"}),(0,t.jsx)("a",{href:"/ui/register",className:"px-6 py-3 rounded-xl bg-white/10 font-semibold hover:bg-white/20 transition-colors border border-white/10",children:"Kayıt Ol"})]})]})]})})]})]}),T&&o&&(0,t.jsxs)("div",{className:"fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-xl",children:[(0,t.jsxs)("button",{onClick:()=>_(!1),className:"absolute top-6 right-6 z-[210] flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-red-500/80 text-white rounded-full transition-all border border-white/20",children:[(0,t.jsxs)("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[(0,t.jsx)("line",{x1:"18",y1:"6",x2:"6",y2:"18"}),(0,t.jsx)("line",{x1:"6",y1:"6",x2:"18",y2:"18"})]}),"Kapat"]}),(0,t.jsx)("div",{className:"w-full h-full max-w-[90vw] max-h-[85vh] flex items-center justify-center",children:(0,t.jsx)(r.default,{src:`https://vk-portfolio-api.vkesgin38.workers.dev${o.image_url}`,artboard:B.artboard,stateMachines:B.stateMachines??(B.statemachine?[B.statemachine]:[]),texts:$?{ButtonText:$,Text:$,Label:$,Title:$,"Text 1":$,Yazi:$,Metin:$,Run:$,TextRun:$,"Text Run 1":$,"Text Run":$}:void 0})}),(0,t.jsx)("div",{className:"absolute bottom-10 left-1/2 -translate-x-1/2 px-6 py-3 bg-black/50 border border-white/10 rounded-full text-white/50 text-sm backdrop-blur-md",children:"Fareyle üzerine gelin veya tıklayarak etkileşime girin."})]})]})}])}]);