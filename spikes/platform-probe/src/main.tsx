import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {EditorView} from '@codemirror/view';
import {EditorState} from '@codemirror/state';
import {MergeView,unifiedMergeView} from '@codemirror/merge';
import {invoke} from '@tauri-apps/api/core';
import {extensions,needsLargeFileView} from './editor';
import './style.css';
const samples:Record<string,[string,string]>={
 csharp:['public sealed class StaminaPool\n{\n    public float Current { get; private set; }\n    public void Spend(float cost) { Current -= cost; }\n}', 'public sealed class StaminaPool\n{\n    public float Current { get; private set; }\n    public bool TrySpend(float cost)\n    {\n        if (cost < 0 || Current < cost) return false;\n        Current -= cost;\n        return true;\n    }\n}'],
 typescript:['function spend(current: number, cost: number) {\n  return current - cost;\n}', 'function spend(current: number, cost: number) {\n  if (cost < 0 || current < cost) return current;\n  return current - cost;\n}'],
 python:['def spend(current, cost):\n    return current - cost', 'def spend(current, cost):\n    if cost < 0 or current < cost:\n        return current\n    return current - cost'],
};
function App(){
 const [language,setLanguage]=useState('csharp'),[mode,setMode]=useState('code'),[explain,setExplain]=useState(false),[scale,setScale]=useState(15),[hello,setHello]=useState('Не проверено'),[large,setLarge]=useState(false),[timing,setTiming]=useState(0);
 const mount=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!mount.current)return;const start=performance.now();const [old,current]=samples[language];
  const text=large?current.repeat(60000):current;
  if(needsLargeFileView(text)){setTiming(performance.now()-start);return;}
  const extra=EditorView.theme({'&':{fontSize:`${scale}px`}});
  const view=mode==='split'?new MergeView({parent:mount.current,a:{doc:old,extensions:[...extensions(language),extra]},b:{doc:text,extensions:[...extensions(language),extra]}}):new EditorView({parent:mount.current,state:mode==='unified'?EditorState.create({doc:text,extensions:[...extensions(language),extra,unifiedMergeView({original:old,mergeControls:false})]}):EditorState.create({doc:text,extensions:[...extensions(language),extra]})});
  setTiming(performance.now()-start);return ()=>view.destroy();
 },[language,mode,scale,large]);
 return <main style={{fontSize:scale}}><header><strong>AwesomeGitAi · platform probe</strong><span>Эксперимент · только демонстрационные данные</span></header>
 <nav><label>Язык <select value={language} onChange={e=>setLanguage(e.target.value)}><option value="csharp">C#</option><option value="typescript">TypeScript</option><option value="python">Python</option></select></label><label>Вид <select value={mode} onChange={e=>setMode(e.target.value)}><option value="code">Код</option><option value="unified">Diff в строку</option><option value="split">Diff рядом</option></select></label><label>Размер <input aria-label="Размер текста" type="range" min="14" max="22" value={scale} onChange={e=>setScale(+e.target.value)}/>{scale}</label><button onClick={()=>setLarge(!large)}>{large?'Обычный файл':'Файл >2 MiB'}</button></nav>
 <section className="workspace"><article><div className="filebar">{language==='csharp'?'StaminaPool.cs':language==='python'?'stamina.py':'stamina.ts'} · только чтение <button aria-expanded={explain} onClick={()=>setExplain(!explain)}>Объяснить изменение</button></div><div ref={mount}/>{large&&<p>Файл превышает лимит 2 MiB. Полный редактор не загружен. Выберите обычный файл.</p>}</article>{explain&&<aside><h2>Проверка перед списанием</h2><p>Если ресурса недостаточно или стоимость отрицательна, запас остаётся прежним.</p><p>Учебный пример. Причина записана вручную для probe; тест реального проекта не запускался.</p><button onClick={()=>setExplain(false)}>Закрыть объяснение</button></aside>}</section>
 <footer><button onClick={async()=>{try{setHello(JSON.stringify(await invoke('hello')))}catch{setHello('Native host недоступен: откройте установленный Tauri probe')}}}>Проверить native host / Git</button><output aria-live="polite">{hello}</output><span>Создание viewer: {timing.toFixed(1)} ms (не полный render)</span></footer></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
