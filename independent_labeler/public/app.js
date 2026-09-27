const $ = id => document.getElementById(id);
const svg = $('canvas'), photo = $('photo'), dots = $('dots'), viewer = $('viewer');
const preferenceKey = 'mobile-dlc-labeler-display-v2';
function savedDisplay() {
  try { const v=JSON.parse(localStorage.getItem(preferenceKey));
    if(v && Number.isFinite(v.size) && v.size>=3 && v.size<=18 && ['circle','square','diamond'].includes(v.shape) && /^#[0-9a-f]{6}$/i.test(v.color)) return v;
  } catch (_) {}
  return {size:7,shape:'circle',color:'#45d4b0'};
}
const state = { project: null, index: 0, points: {}, selected: new Set(), active: null,
  mode: 'select', view: null, pointers: new Map(), gesture: null, pending: Promise.resolve(),
  undo: [], redo: [], display: savedDisplay(), frameVersion: 0, revision: 0,
  paradigm: null, indices: [] };
const palette = ['#45d4b0','#6ea9ff','#ffbc63','#ff7d9b','#b59bff','#e1db82','#7ddac7'];
const placeDragThreshold = 9;
const current = () => state.project.frames[state.index];
function api(path) { return path; }
async function request(path, data) {
  const response = await fetch(api(path), data === undefined ? {} : {method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data)});
  if (response.status===401) { location.replace('/'); throw Error('Session ended'); }
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Request failed');
  return result;
}
function status(message, error=false) { $('status').textContent=message; $('status').classList.toggle('error',error); }
function partName(part) { return state.project.display_names?.[part] || part?.replaceAll('_',' ') || ''; }
function viewBox() { const v=state.view; svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); }
function fit() { const f=current(); state.view={x:0,y:0,w:f.width,h:f.height}; viewBox(); render(); }
function coordinate(event) { const p=svg.createSVGPoint(); p.x=event.clientX; p.y=event.clientY; const pos=p.matrixTransform(svg.getScreenCTM().inverse()); return [pos.x,pos.y]; }
function zoom(factor, clientX, clientY) {
  if(!state.view)return;
  const anchor=coordinate({clientX,clientY}), old=state.view, f=current();
  const w=Math.max(f.width/12,Math.min(f.width*2,old.w*factor)), scale=w/old.w;
  state.view={x:old.x,y:old.y,w,h:old.h*scale};viewBox();
  const moved=coordinate({clientX,clientY});state.view.x+=anchor[0]-moved[0];state.view.y+=anchor[1]-moved[1];
  viewBox();render();
}
function pointSize() { return state.display.size * state.view.w / Math.max(220,viewer.clientWidth); }
function marker(part, point, index) {
  const ns='http://www.w3.org/2000/svg', group=document.createElementNS(ns,'g');
  group.dataset.part=part;
  const r=pointSize(), color=state.display.color || palette[index%palette.length], selected=state.selected.has(part);
  if (selected) { const halo=document.createElementNS(ns,'circle'); halo.setAttribute('cx',point[0]);halo.setAttribute('cy',point[1]);halo.setAttribute('r',r*2.4);halo.setAttribute('fill','#fff');halo.setAttribute('fill-opacity','.20');halo.setAttribute('stroke','#fff');halo.setAttribute('stroke-width',r*.55);group.append(halo); }
  const shape=document.createElementNS(ns, state.display.shape==='circle'?'circle':'rect');
  if (state.display.shape==='circle') {shape.setAttribute('cx',point[0]);shape.setAttribute('cy',point[1]);shape.setAttribute('r',r);}
  else {shape.setAttribute('x',point[0]-r);shape.setAttribute('y',point[1]-r);shape.setAttribute('width',r*2);shape.setAttribute('height',r*2);if(state.display.shape==='diamond')shape.setAttribute('transform',`rotate(45 ${point[0]} ${point[1]})`);}
  shape.setAttribute('fill',color);shape.setAttribute('stroke','#142130');shape.setAttribute('stroke-width',r*.25);shape.setAttribute('pointer-events','none');group.append(shape);
  const hit=document.createElementNS(ns,'circle');hit.setAttribute('cx',point[0]);hit.setAttribute('cy',point[1]);hit.setAttribute('r',Math.max(r*2.5, 17*state.view.w/Math.max(220,viewer.clientWidth)));hit.setAttribute('fill','transparent');hit.dataset.part=part;group.append(hit);
  return group;
}
function render() {
  if (!state.project || !state.view) return;
  dots.replaceChildren();
  state.project.bodyparts.forEach((part,i)=> {if(state.points[part])dots.append(marker(part,state.points[part],i));});
  $('selected').textContent=state.selected.size>1?`${state.selected.size} selected`:(state.project.display_names?.[state.active] || state.active || 'Select a point');
  const activeName=partName(state.active) || 'Choose a body point';
  $('active-chip').textContent=`${state.mode==='add'?'Place':'Selected'}: ${activeName}${state.points[state.active] ? ' · placed' : ' · missing'}`;
  const placed=state.project.bodyparts.filter(part=>state.points[part]).length, total=state.project.bodyparts.length;
  $('completion').textContent=`${placed} / ${total}`;
  $('progress-fill').style.width=`${total ? placed/total*100 : 0}%`;
  document.querySelector('.progress-track').setAttribute('aria-valuenow',String(total ? Math.round(placed/total*100) : 0));
  $('next-missing').disabled=placed===total;
  const partsScroll=$('parts').scrollLeft;
  $('parts').replaceChildren(...state.project.bodyparts.map((part,i)=>{
    const btn=document.createElement('button');btn.className='part'+(state.active===part?' chosen':'');btn.type='button';
    const bullet=document.createElement('span');bullet.className='bullet';bullet.style.background=palette[i%palette.length];bullet.textContent=state.points[part]?'✓':'+';
    const name=document.createElement('span');name.textContent=partName(part);
    btn.append(bullet,name);btn.setAttribute('aria-pressed',String(state.active===part));btn.onclick=()=>{state.active=part;state.selected=new Set([part]);render();};return btn;
  }));
  $('parts').scrollLeft=partsScroll;
  $('delete').disabled=!state.selected.size;
  $('undo').disabled=!state.undo.length;
  $('redo').disabled=!state.redo.length;
}
async function frame(index) {
  const position=state.indices.indexOf(index);
  if(position<0)return;
  selectMode('select');state.gesture=null;state.pointers.clear();
  const version=++state.frameVersion;
  try {
    await state.pending;
    if(version!==state.frameVersion)return;
    const f=state.project.frames[index], data=await request('/api/frame?key='+encodeURIComponent(f.key));
    if(version!==state.frameVersion)return;
    const previous=state.view?current():null, oldView=state.view;
    state.index=index;state.points=data.points;state.revision=data.revision;
    state.active=state.active || state.project.bodyparts.find(part=>!state.points[part]) || state.project.bodyparts[0];
    state.selected=new Set([state.active]);state.undo=[];state.redo=[];
    photo.setAttribute('href',api('/api/image?key='+encodeURIComponent(f.key)));
    photo.setAttribute('width',f.width);photo.setAttribute('height',f.height);
    if(oldView && previous){state.view={x:oldView.x*f.width/previous.width,y:oldView.y*f.height/previous.height,w:oldView.w*f.width/previous.width,h:oldView.h*f.height/previous.height};viewBox();render();}
    else fit();
    const paradigm=state.project.paradigms.find(item=>item.id===state.paradigm);
    $('subtitle').textContent=`${paradigm?.name || state.project.project_name || 'Project'} · ${f.folder}`;
    $('frame-title').textContent=f.name;
    $('counter').textContent=`${position+1} / ${state.indices.length}`;
    $('folder-select').value=f.folder;
    $('frame-range').value=position+1;
    $('frame-range').disabled=state.indices.length<2;
    $('previous').disabled=position===0;$('next').disabled=position===state.indices.length-1;
    status('Saved');
  } catch(e) {
    if(version===state.frameVersion){$('frame-range').value=state.indices.indexOf(state.index)+1;$('folder-select').value=current().folder;status(e.message,true);}
  }
}
function setParadigm(id, preferredIndex) {
  state.paradigm=id;
  state.indices=state.project.frames.flatMap((item,index)=>item.paradigm===id?[index]:[]);
  if(!state.indices.length){status('No frames in this experiment',true);return;}
  $('paradigm-select').value=id;
  $('frame-range').max=state.indices.length;
  const folders=[...new Set(state.indices.map(index=>state.project.frames[index].folder))];
  $('folder-select').replaceChildren(...folders.map(folder=>{
    const option=document.createElement('option');option.value=folder;option.textContent=folder;return option;
  }));
  state.view=null;
  return frame(state.indices.includes(preferredIndex)?preferredIndex:state.indices[0]);
}
async function nextIncompleteFrame() {
  try {
    await state.pending;status('Finding frame…');
    const {index}=await request('/api/next-incomplete?after='+state.index+'&paradigm='+encodeURIComponent(state.paradigm));
    if(index===null)status('Every frame in this experiment is complete');
    else {await frame(index);status('Next incomplete frame');}
  } catch(e) { status(e.message,true); }
}
function nextMissingPart(after) {
  const parts=state.project.bodyparts, start=Math.max(0,parts.indexOf(after));
  return parts.slice(start+1).concat(parts.slice(0,start+1)).find(part=>!state.points[part]);
}
function nextMissingLabel() {
  const missing=nextMissingPart(state.active);
  if(!missing){status('This frame is complete');return;}
  state.active=missing;state.selected=new Set([missing]);render();status(state.mode==='add'?`Ready to place ${partName(missing)}`:`Selected ${partName(missing)}`);
}
function apply(changes, remember=true) {
  const before={};for(const part of Object.keys(changes)){before[part]=state.points[part] ? [...state.points[part]] : null;state.points[part]=changes[part];}
  if(remember){state.undo.push({before,after:changes});state.redo=[];}
  const key=current().key;render();status('Saving…');
  state.pending=state.pending.catch(()=>{}).then(()=>request('/api/edit',{key,changes,revision:state.revision})).then(result=>{state.revision=result.revision;status('Saved');}).catch(async error=>{
    status(`Save failed: ${error.message}`,true);
    try {const latest=await request('/api/frame?key='+encodeURIComponent(key));state.points=latest.points;state.revision=latest.revision;state.undo=[];state.redo=[];render();} catch (_) {}
    throw error;
  });
}
function selectMode(mode) {state.mode=mode;document.querySelectorAll('.mode').forEach(b=>{const active=b.dataset.mode===mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});viewer.dataset.mode=mode;render();}
function pointerDown(e) {
  if(!state.project||!state.view||e.target.closest('.view-tools')||(e.pointerType==='mouse'&&e.button!==0))return;
  viewer.setPointerCapture(e.pointerId);state.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const part=e.target.dataset.part || e.target.parentNode?.dataset?.part;
  if(state.pointers.size===2) {
    if(state.gesture?.kind==='move'){state.points[state.gesture.part]=state.gesture.old;render();}
    const center=pointerCenter();state.gesture={kind:'pinch',distance:distance(),view:{...state.view},anchor:coordinate({clientX:center.x,clientY:center.y})};return;
  }
  if(state.pointers.size>2)return;
  if(part && state.mode==='multi') {state.selected.has(part)?state.selected.delete(part):state.selected.add(part);state.active=part;render();return;}
  if(part && state.mode==='select') {state.active=part;state.selected=new Set([part]);state.gesture={kind:'move',part,old:state.points[part]};render();return;}
  if(state.mode==='add' && state.active) {
    state.gesture={kind:'place',part:state.active,x:e.clientX,y:e.clientY,view:{...state.view}};
  } else {state.gesture={kind:'pan',x:e.clientX,y:e.clientY,view:{...state.view}};}
}
function distance(){const p=[...state.pointers.values()];return Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);}
function pointerCenter(){const p=[...state.pointers.values()];return {x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2};}
function pointerMove(e){
  if(!state.pointers.has(e.pointerId))return;
  state.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const g=state.gesture;if(!g)return;
  if(g.kind==='pinch'&&state.pointers.size===2){
    const f=current(), w=Math.max(f.width/12,Math.min(f.width*2,g.view.w*g.distance/Math.max(1,distance()))), scale=w/g.view.w;
    state.view={x:g.view.x,y:g.view.y,w,h:g.view.h*scale};viewBox();
    const center=pointerCenter(),mapped=coordinate({clientX:center.x,clientY:center.y});
    state.view.x+=g.anchor[0]-mapped[0];state.view.y+=g.anchor[1]-mapped[1];viewBox();render();
  }
  if(g.kind==='place'&&Math.hypot(e.clientX-g.x,e.clientY-g.y)>placeDragThreshold)g.kind='pan';
  if(g.kind==='pan') {const scale=Math.min(viewer.clientWidth/g.view.w,viewer.clientHeight/g.view.h);state.view.x=g.view.x-(e.clientX-g.x)/scale;state.view.y=g.view.y-(e.clientY-g.y)/scale;viewBox();}
  if(g.kind==='move'&&state.pointers.size===1){const p=coordinate(e),f=current();state.points[g.part]=[Math.max(0,Math.min(f.width-1,p[0])),Math.max(0,Math.min(f.height-1,p[1]))];render();}
}
function pointerUp(e){
  if(!state.pointers.has(e.pointerId))return;
  state.pointers.delete(e.pointerId);
  const g=state.gesture;if(g?.kind==='move'&&g.part&&state.points[g.part]){
    if(e.type==='pointercancel'){state.points[g.part]=g.old;render();state.gesture=null;return;}
    const changed=state.points[g.part],old=g.old;
    if(!old||Math.hypot(changed[0]-old[0],changed[1]-old[1])>.2){state.points[g.part]=old;apply({[g.part]:changed});}
  }
  if(g?.kind==='place'&&e.type==='pointerup'&&state.pointers.size===0&&state.mode==='add'&&g.part===state.active){
    const p=coordinate(e),f=current();
    if(p[0]>=0&&p[0]<f.width&&p[1]>=0&&p[1]<f.height){
      apply({[g.part]:p});
      const parts=state.project.bodyparts,next=parts[parts.indexOf(g.part)+1];
      if(next){state.active=next;state.selected=new Set([next]);}
      else selectMode('select');
      render();
    }
  }
  state.gesture=null;
}
async function init(){
  try {state.project=await request('/api/project');const p=state.project;
    $('animal').textContent=(p.individuals && p.individuals[0]) || 'animal';
    $('paradigm-select').replaceChildren(...p.paradigms.map(item=>{
      const option=document.createElement('option');option.value=item.id;option.textContent=item.name;return option;
    }));
    $('paradigm-select').hidden=p.paradigms.length<2;
    $('note').textContent=p.demo?'Preview project: export unavailable.':
      p.compatible?'':`Export unavailable: this ${p.bodyparts.length}-point layout differs from the project config (${p.config_bodyparts.length} points).`;
    $('export').disabled=p.demo||!p.compatible;
    await setParadigm(p.paradigms[0].id,p.start_index || 0);
  }catch(e){status(e.message,true);$('note').textContent='Check the project folder and server console.';}
}
for(const [id,key] of [['size','size'],['shape','shape'],['color','color']])$(id).value=state.display[key];
$('size-value').textContent=`${state.display.size} px`;
document.querySelectorAll('.mode').forEach(b=>b.onclick=()=>selectMode(b.dataset.mode));
viewer.addEventListener('pointerdown',pointerDown);viewer.addEventListener('pointermove',pointerMove);viewer.addEventListener('pointerup',pointerUp);viewer.addEventListener('pointercancel',pointerUp);
viewer.addEventListener('dblclick',fit);viewer.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.16:.86,e.clientX,e.clientY);},{passive:false});
$('previous').onclick=()=>frame(state.indices[state.indices.indexOf(state.index)-1]);
$('next').onclick=()=>frame(state.indices[state.indices.indexOf(state.index)+1]);$('reset').onclick=fit;
$('frame-range').onchange=e=>frame(state.indices[Number(e.target.value)-1]);
$('paradigm-select').onchange=e=>setParadigm(e.target.value);
$('folder-select').onchange=e=>frame(state.indices.find(index=>state.project.frames[index].folder===e.target.value));
$('zoom-in').onclick=()=>{const b=svg.getBoundingClientRect();zoom(.8,b.left+b.width/2,b.top+b.height/2);};
$('zoom-out').onclick=()=>{const b=svg.getBoundingClientRect();zoom(1.25,b.left+b.width/2,b.top+b.height/2);};
$('delete').onclick=()=>{const changes={};for(const part of state.selected)changes[part]=null;if(Object.keys(changes).length)apply(changes);};
$('undo').onclick=()=>{const entry=state.undo.pop();if(entry){state.redo.push(entry);apply(entry.before,false);render();}};
$('redo').onclick=()=>{const entry=state.redo.pop();if(entry){state.undo.push(entry);apply(entry.after,false);render();}};
$('next-missing').onclick=nextMissingLabel;
$('next-incomplete').onclick=nextIncompleteFrame;
$('share-url').textContent=location.origin+'/';
$('copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(location.origin+'/');status('Link copied');}catch(_){status('Could not copy link',true);}};
$('sign-out').onclick=async()=>{try{await fetch('/api/logout',{method:'POST'});}finally{location.replace('/');}};
$('export').onclick=async()=>{try{await state.pending;status('Preparing download…');const response=await fetch('/api/export');if(!response.ok)throw Error((await response.json()).error || 'Export failed');const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`dlc-labels-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status('Label snapshot downloaded');$('note').textContent='Use import_hosted.py to create DLC H5 and CSV files on this laptop.';}catch(e){status(e.message,true);}};
for(const [id,key] of [['size','size'],['shape','shape'],['color','color']])$(id).oninput=e=>{
  state.display[key]=key==='size'?+e.target.value:e.target.value;
  $('size-value').textContent=`${state.display.size} px`;
  try {localStorage.setItem(preferenceKey,JSON.stringify(state.display));} catch (_) {}
  render();
};
init();
