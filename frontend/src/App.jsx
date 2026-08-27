import React, { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import { api, TOKENS } from './api.js';
import { enqueue, readQueue, replaceQueue } from './offline.js';

const CENTERS={CHOCO:[5.6947,-76.6611],PEREIRA:[4.8143,-75.6946],CALI:[3.4516,-76.5320],MANIZALES:[5.0703,-75.5138]};
const LABELS={CHOCO:'Chocó',PEREIRA:'Pereira',CALI:'Cali',MANIZALES:'Manizales'};
const TYPES={USAR_MEDICAL:'Búsqueda/rescate o emergencia médica',SHELTER:'Albergue temporal',SUPPLIES:'Suministros básicos',DAMAGE_ASSESSMENT:'Daño estructural'};

function Recenter({ center }) {
  const map = useMap();

  useEffect(() => {
    map.setView(center, 12);
  }, [center, map]);

  return null;
}
function HealthStrip(){
  const [health,setHealth]=useState({});
  async function check(){
    const names=['intake','dispatch','geospatial','notification'];
    const next={};
    await Promise.all(names.map(async n=>{try{await api.health(n);next[n]='up'}catch{next[n]='down'}}));
    setHealth(next);
  }
  useEffect(()=>{check();const id=setInterval(check,5000);return()=>clearInterval(id)},[]);
  return <div className="health-strip">{Object.entries(health).map(([k,v])=><span key={k} className={v}>{k}: {v==='up'?'OK':'CAÍDO'}</span>)}</div>
}

function CriticalFields({type,data,setData}){
  const set=(k,v)=>setData({...data,[k]:v});
  if(type==='USAR_MEDICAL') return <><label>Personas afectadas<input type="number" min="1" value={data.people_affected||''} onChange={e=>set('people_affected',Number(e.target.value))}/></label><label>Riesgo<select value={data.imminent_risk||''} onChange={e=>set('imminent_risk',e.target.value)}><option value="">Seleccione</option><option>FIRE</option><option>GAS_LEAK</option><option>COLLAPSE</option><option>MEDICAL</option></select></label></>;
  if(type==='SHELTER') return <><label>Adultos<input type="number" min="0" value={data.adults??''} onChange={e=>set('adults',Number(e.target.value))}/></label><label>Niños<input type="number" min="0" value={data.children??''} onChange={e=>set('children',Number(e.target.value))}/></label><label>Adultos mayores<input type="number" min="0" value={data.older_adults??''} onChange={e=>set('older_adults',Number(e.target.value))}/></label><label>Habitabilidad<select value={data.home_habitability||''} onChange={e=>set('home_habitability',e.target.value)}><option value="">Seleccione</option><option>UNINHABITABLE</option><option>PARTIAL</option><option>UNKNOWN</option></select></label><label className="check"><input type="checkbox" checked={Boolean(data.accessibility_required)} onChange={e=>set('accessibility_required',e.target.checked)}/> Requiere accesibilidad</label></>;
  if(type==='SUPPLIES') return <><label>Categoría<select value={data.category||''} onChange={e=>set('category',e.target.value)}><option value="">Seleccione</option><option>WATER</option><option>FOOD</option><option>FIRST_AID</option><option>CHRONIC_MEDICATION</option></select></label><label>Cantidad<input type="number" min="1" value={data.quantity||''} onChange={e=>set('quantity',Number(e.target.value))}/></label></>;
  return <><label>Edificación<input value={data.building_type||''} onChange={e=>set('building_type',e.target.value)}/></label><label>Agrietamiento<select value={data.crack_level||''} onChange={e=>set('crack_level',e.target.value)}><option value="">Seleccione</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></label><label>Riesgo de colapso<select value={data.collapse_risk||''} onChange={e=>set('collapse_risk',e.target.value)}><option value="">Seleccione</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>IMMINENT</option></select></label><label>Referencia fotográfica<input type="url" placeholder="https://..." value={data.evidence_photo_url||''} onChange={e=>set('evidence_photo_url',e.target.value)}/></label></>;
}

function Citizen(){
  const token=TOKENS.citizen;
  const [type,setType]=useState('USAR_MEDICAL'),[city,setCity]=useState('CALI'),[critical,setCritical]=useState({}),[msg,setMsg]=useState('');
  const [lat,setLat]=useState(CENTERS.CALI[0]),[lng,setLng]=useState(CENTERS.CALI[1]),[queued,setQueued]=useState(readQueue().length);
  function changeCity(c){setCity(c);setLat(CENTERS[c][0]);setLng(CENTERS[c][1])}
  async function flush(){const remaining=[];for(const item of readQueue()){try{await api.createEmergency(token,item)}catch{remaining.push(item)}}replaceQueue(remaining);setQueued(remaining.length)}
  useEffect(()=>{window.addEventListener('online',flush);flush();return()=>window.removeEventListener('online',flush)},[]);
  async function submit(e){e.preventDefault();const payload={type,city,latitude:lat,longitude:lng,critical_data:critical,idempotency_key:crypto.randomUUID()};try{const r=await api.createEmergency(token,payload);setMsg(`Radicada ${r.emergency.priority} · ${r.emergency.id}`);setCritical({})}catch(err){if(!navigator.onLine || !err.status || err.status>=500){enqueue(payload);setQueued(readQueue().length);setMsg(`Backend no disponible. Guardada offline: ${err.message}`)}else{setMsg(`Solicitud rechazada: ${err.message}`)}}}
  return <div className="grid"><section className="card"><div className="eyebrow">Ciudadano · PWA offline-first</div><h2>Radicar emergencia</h2>{queued>0&&<div className="warning">{queued} reporte(s) en cola local</div>}<form onSubmit={submit} className="form-grid"><label>Tipo<select value={type} onChange={e=>{setType(e.target.value);setCritical({})}}>{Object.entries(TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Ciudad<select value={city} onChange={e=>changeCity(e.target.value)}>{Object.entries(LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Latitud<input type="number" step="any" value={lat} onChange={e=>setLat(Number(e.target.value))}/></label><label>Longitud<input type="number" step="any" value={lng} onChange={e=>setLng(Number(e.target.value))}/></label><CriticalFields type={type} data={critical} setData={setCritical}/><button className="primary full">Enviar emergencia</button></form>{msg&&<p className="notice">{msg}</p>}</section><section className="card"><h2>Ubicación</h2><MapContainer center={[lat,lng]} zoom={12} className="map"><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap"/><Recenter center={[lat,lng]}/><CircleMarker center={[lat,lng]} radius={10}><Popup>Reporte</Popup></CircleMarker></MapContainer></section></div>
}

function Operator(){
  const token=TOKENS.operator;
  const [city,setCity]=useState('CALI'),[data,setData]=useState({emergencies:[],hotspots:[],resources:[]}),[msg,setMsg]=useState('');
  const center=useMemo(()=>CENTERS[city],[city]);
  async function refresh(){try{setData(await api.zone(token,city));setMsg('')}catch(e){setMsg(e.message)}}
  useEffect(()=>{refresh();const id=setInterval(refresh,5000);return()=>clearInterval(id)},[city]);
  async function assign(id){try{const r=await api.dispatch(token,id);setMsg(`Despacho ${r.assignment.dispatch_id} creado`);refresh()}catch(e){setMsg(e.message)}}
  return <div className="stack"><section className="card toolbar"><div><div className="eyebrow">Operador</div><h2>Centro de comando</h2></div><select value={city} onChange={e=>setCity(e.target.value)}>{Object.entries(LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></section>{msg&&<div className="notice">{msg}</div>}<section className="stats"><div><b>{data.emergencies.length}</b><span>Emergencias</span></div><div><b>{data.hotspots.length}</b><span>Hotspots</span></div><div><b>{data.resources.filter(x=>x.status==='AVAILABLE').length}</b><span>Recursos libres</span></div></section><div className="grid"><section className="card"><MapContainer center={center} zoom={12} className="map tall"><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap"/><Recenter center={center}/>{data.emergencies.map(e=><CircleMarker key={e.id} center={[e.latitude,e.longitude]} radius={e.priority==='P1'?11:7}><Popup>{e.priority} · {e.type}<br/>{e.status}</Popup></CircleMarker>)}</MapContainer></section><section className="card"><h3>Cola priorizada</h3><div className="table-wrap"><table><thead><tr><th>Prioridad</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>{data.emergencies.map(e=><tr key={e.id}><td><span className={`p ${e.priority}`}>{e.priority}</span></td><td>{TYPES[e.type]}</td><td>{e.status}</td><td><button onClick={()=>assign(e.id)} disabled={!['RECEIVED','TRIAGED'].includes(e.status)}>Asignar</button></td></tr>)}</tbody></table></div></section></div></div>
}

export default function App(){
  const [role,setRole]=useState('citizen');
  return <div className="shell"><header><div><b>RESCUE//CO</b><small>Arquitectura resiliente · laboratorio Docker</small></div><div className="role"><button className={role==='citizen'?'active':''} onClick={()=>setRole('citizen')}>Ciudadano</button><button className={role==='operator'?'active':''} onClick={()=>setRole('operator')}>Operador</button></div></header><HealthStrip/><main>{role==='citizen'?<Citizen/>:<Operator/>}</main><footer>Creado por: Jorge Luis Osorio · entorno local desacoplado</footer></div>
}
