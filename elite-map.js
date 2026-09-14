'use strict';
const $=id=>document.getElementById(id);
const CIRCUITS=[
 {id:'LON',name:'Londrina e entorno',days:[0,5],cities:['Londrina','Cambé','Ibiporã','Jataizinho']},
 {id:'OESTE',name:'Rolândia e Arapongas',days:[1],cities:['Rolândia','Arapongas']},
 {id:'SUL',name:'Apucarana e sul',days:[6],cities:['Apucarana','Cambira','Novo Itacolomi','Rio Bom','Califórnia','Marilândia do Sul','Mauá da Serra','Tamarana']},
 {id:'PARA',name:'Paranapanema',days:[2],cities:CONFIG.regions.R2.cities.slice()},
 {id:'CORN',name:'Cornélio e entorno',days:[7],cities:CONFIG.regions.R3.cities.slice()},
 {id:'NPA',name:'Norte Pioneiro A',days:[3],cities:CONFIG.regions.R4A.cities.slice()},
 {id:'NPB',name:'Norte Pioneiro B',days:[8],cities:CONFIG.regions.R4B.cities.slice()}
];
const allCities=[...new Set(Object.values(CONFIG.regions).flatMap(r=>r.cities))];
const EXTRA=['cnpj','legalName','email','address','visitAddress','postcode','cnae','eliteReason','lastVisit','latitude','longitude','geoStatus'];
let editSession=0,lookupBusy=false,visitMap,markerLayer,leafletPromise;
function dateOK(s){return /^\d{4}-\d{2}-\d{2}$/.test(s||'')&&!isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
function addDays(s,n){const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function monday(s){return addDays(s,-((new Date(s+'T12:00:00Z').getUTCDay()+6)%7));}
function fmt(s){return dateOK(s)?s.split('-').reverse().join('/'):'Sem visita registrada';}
function normalizeV3(s){
 s=migrateState(s);s.weekKey=CONFIG.regions[s.weekKey]?s.weekKey:'R1';s.goals={...structuredClone(defaultState.goals),...s.goals};
 s.circuitSettings=s.circuitSettings||{};s.cityCircuit=s.cityCircuit||{};
 s.cycleAnchor=dateOK(s.cycleAnchor)?monday(s.cycleAnchor):monday(todayISO());s.schemaVersion=3;
 s.accounts=s.accounts.map(a=>({...a,stage:a.stage||'Prospect',priority:['A','B','C'].includes(a.priority)?a.priority:'B',elite:a.elite===true,visits:Array.isArray(a.visits)?a.visits:[]}));return s;
}
state=normalizeV3(state);
function circuitOf(city){const n=normKey(city);return CIRCUITS.find(c=>c.id===state.cityCircuit[n])||CIRCUITS.find(c=>c.cities.some(x=>normKey(x)===n));}
function originalRegion(city){return Object.keys(CONFIG.regions).find(k=>CONFIG.regions[k].cities.some(c=>normKey(c)===normKey(city)));}
function dueDate(a){return dateOK(a.lastVisit)?addDays(a.lastVisit,15):todayISO();}
function visitStatus(a){return !dateOK(a.lastVisit)?'Primeira visita a agendar':dueDate(a)<todayISO()?'Atrasada':dueDate(a)<=addDays(todayISO(),3)?'Vence em breve':'Em dia';}
function settingsFor(c){const s=state.circuitSettings[c.id]||{};return {days:Array.isArray(s.days)&&s.days.length?s.days.filter(n=>Number.isInteger(n)&&n>=0&&n<10):c.days,capacity:Math.max(1,Math.min(12,Math.floor(Number(s.capacity)||5)))};}
function slotsFor(c){
 const s=settingsFor(c),today=todayISO(),elapsed=Math.floor((Date.parse(today+'T12:00:00Z')-Date.parse(state.cycleAnchor+'T12:00:00Z'))/86400000),cycle=addDays(state.cycleAnchor,Math.floor(elapsed/14)*14),slots=[];
 for(let n=0;n<3;n++)for(const day of s.days){const date=addDays(cycle,n*14+(day<5?day:day+2));if(date>=today&&date<addDays(today,14))slots.push({date,capacity:s.capacity,accounts:[]});}
 return slots.sort((a,b)=>a.date.localeCompare(b.date));
}
function planCircuit(c){
 const slots=slotsFor(c),unplaced=[],accounts=state.accounts.filter(a=>a.elite&&circuitOf(a.city)?.id===c.id).sort((a,b)=>dueDate(a).localeCompare(dueDate(b))||a.company.localeCompare(b.company));
 for(const a of accounts){const eligible=slots.filter(s=>!dateOK(a.lastVisit)||s.date>a.lastVisit);const slot=eligible.find(s=>s.accounts.length<s.capacity);if(slot)slot.accounts.push(a);else if(eligible.length)unplaced.push(a);}return {slots,unplaced,accounts};
}
function candidate(a){
 const name=normKey(a.company),reasons=[];let points=0;
 if(/integrada|coamo|yamadiesel|cnpj nao e valido/.test(name))return {points:0,reasons:[]};
 if(a.priority==='A'){points+=3;reasons.push('Prioridade A já indicada na carteira');}
 if(['Proposta','Negociação'].includes(a.stage)){points+=4;reasons.push('Negociação registrada');}
 if(a.fleet){points+=2;reasons.push('Frota registrada; verificar renovação');}
 if(a.trigger&&a.trigger!=='Outro'){points+=2;reasons.push('Gatilho comercial registrado');}
 if(/terrap|pavimenta|pedreira|minera/.test(normKey(a.segment))){points+=3;reasons.push('Segmento cadastrado compatível com uso de linha amarela');}
 else if(/terrap|pavimenta|pedreira|calcario|extracao de areia/.test(name)){points+=2;reasons.push('Nome sugere aplicação em linha amarela; atividade a confirmar');}
 else if(/florestal|biomassa|concreteira/.test(normKey(a.segment))){points++;reasons.push('Possível aplicação; volume e frota a confirmar');}
 return {points,reasons};
}
function coords(a){const lat=Number(a.latitude),lng=Number(a.longitude);return a.latitude!==''&&a.latitude!=null&&a.longitude!==''&&a.longitude!=null&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&!(lat===0&&lng===0)?[lat,lng]:null;}
function button(text,fn){const b=document.createElement('button');b.type='button';b.className='btn secondary';b.textContent=text;b.onclick=fn;return b;}
function commit(next){try{localStorage.setItem(KEY,JSON.stringify(next));state=next;renderAll();return true;}catch(e){alert('Não foi possível salvar neste aparelho. Exporte seu backup e confira o espaço disponível.');return false;}}
const css=document.createElement('style');css.textContent=`.nav{grid-template-columns:repeat(6,1fr)}.nav button{font-size:12px}.nav button .ico{font-size:18px}label,.account-meta,.notice,.due,.city,.chip,.btn.small{font-size:14px}.elite-tag{color:#ffc565;font-weight:700}#visitMap{height:55vh;min-height:330px;border-radius:14px;background:#242428;z-index:1}.leaflet-popup-content{color:#171719;font-size:14px}.slot{padding:12px;border:1px solid var(--line);border-radius:12px;margin:10px 0}.slot p{margin:8px 0;line-height:1.5}.warning{color:#ffd27c}.fieldcheck{display:flex;gap:8px;align-items:center;margin:12px 0;color:var(--text)}.fieldcheck input{width:auto}#eliteSummary{line-height:1.6}.map-key{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0;font-size:14px}.map-key span{padding:5px;border-bottom:3px solid}.daychecks{display:flex;flex-wrap:wrap;gap:8px}.daychecks label{border:1px solid var(--line);padding:8px;border-radius:10px}.daychecks input{width:auto}details summary{cursor:pointer;padding:8px 0;font-size:16px}@media(max-width:420px){.btn{padding:12px 10px}.nav button{font-size:11px}}`;document.head.append(css);
document.querySelector('.nav [data-section="pipeline"]').remove();
for(const [id,label,ico] of [['elite','Elite','★'],['map','Mapa','⌖']]){const b=button('',()=>showSection(id));b.dataset.section=id;b.innerHTML='<span class="ico">'+ico+'</span>'+label;document.querySelector('.nav').append(b);}
$('home').insertAdjacentHTML('afterbegin',`<div class="card"><h3>Elite — visitas quinzenais</h3><div id="eliteSummary"></div><div class="btnrow" style="margin-top:10px"><button class="btn" onclick="showSection('elite')">Ver giros e pendências</button><button class="btn secondary" onclick="showSection('pipeline')">Pipeline</button></div></div>`);
document.querySelector('main').insertAdjacentHTML('beforeend',`
 <section id="elite" class="section"><h2>Clientes Elite</h2><p>Visitas em até 15 dias, independentemente da região da semana. Os giros se repetem a cada duas semanas (14 dias).</p><div class="notice">Janelas iniciais sugeridas. Capacidade é um teto de visitas, não um cálculo do tempo de estrada. Ajuste os dias conforme os deslocamentos.</div>
 <div class="card" style="margin-top:12px"><label for="eliteCircuit">Circuito</label><select id="eliteCircuit"></select><div id="elitePlan"></div></div>
 <details class="card"><summary>Organizar circuitos e capacidade</summary><p>Alterar o circuito de uma cidade direciona todos os seus clientes. A região original permanece.</p><label for="cycleAnchor">Segunda-feira de início do ciclo</label><input id="cycleAnchor" type="date"><button class="btn secondary" id="saveAnchor">Salvar início</button><div id="circuitConfig"></div><label for="mappingCity">Cidade para direcionar</label><input id="mappingCity" list="territoryCities"><label for="mappingCircuit">Circuito</label><select id="mappingCircuit"></select><button class="btn" id="saveMapping">Salvar direcionamento</button></details>
 <details class="card" open><summary>Candidatos a Elite — validar potencial</summary><p>Triagem por prioridade, atividade e dados comerciais registrados. Não confirma frota, intenção ou capacidade de compra e não promove clientes automaticamente.</p><div id="eliteCandidates"></div></details></section>
 <section id="map" class="section"><h2>Mapa de clientes</h2><div class="formgrid"><div><label for="mapCircuit">Circuito</label><select id="mapCircuit"></select></div><div><label for="mapKind">Exibir</label><select id="mapKind"><option value="all">Todos</option><option value="elite">Elite</option><option value="due">Elite com visita pendente</option><option value="missing">Sem localização</option></select></div></div><div class="map-key"><span style="border-color:#ff7a00">Elite</span><span style="border-color:#e65757">Elite pendente</span><span style="border-color:#579dee">Demais</span><span style="border-color:#d8b74c">Posição aproximada</span></div><p id="mapStatus" role="status"></p><div id="visitMap"></div><p>Confira a posição antes de navegar. A localização por CEP é aproximada. O mapa de ruas precisa de internet.</p><div id="mapList" class="list"></div><details class="card"><summary>Mapa original do território</summary><img class="mapimg" src="mapa-territorio.jpeg" alt="Território no Norte do Paraná"></details></section>`);
$('region').insertAdjacentHTML('afterbegin','<option value="UNMAPPED">Definir região</option>');
$('territoryCities').innerHTML=allCities.map(c=>'<option value="'+esc(c)+'">').join('');
$('accountForm').insertAdjacentHTML('afterbegin',`
 <div class="span2"><label for="cnpj">CNPJ</label><input id="cnpj" placeholder="Digite o CNPJ"><button class="btn secondary" type="button" id="lookupCnpj">Consultar CNPJ e posição</button><p id="lookupStatus" role="status"></p></div><div><label for="legalName">Razão social</label><input id="legalName"></div><div><label for="email">E-mail cadastral</label><input id="email" type="email"></div>
 <div class="span2"><label for="address">Endereço cadastral</label><input id="address"></div><div><label for="postcode">CEP</label><input id="postcode" inputmode="numeric"></div><div><label for="cnae">Atividade principal (CNAE)</label><input id="cnae"></div><div class="span2"><label for="visitAddress">Endereço da visita (se diferente)</label><input id="visitAddress" placeholder="Fazenda, obra, entrada ou unidade de operação"></div>
 <div><label for="latitude">Latitude</label><input id="latitude" type="number" step="any" min="-90" max="90"></div><div><label for="longitude">Longitude</label><input id="longitude" type="number" step="any" min="-180" max="180"></div><div><label for="geoStatus">Precisão da posição</label><select id="geoStatus"><option value="">Sem localização</option><option value="approximate">Aproximada pelo CEP</option><option value="manual">Ajustada manualmente</option><option value="gps">GPS no local da visita</option><option value="confirmed">Confirmada em campo</option></select></div><div class="btnrow"><button class="btn secondary" type="button" id="useGps">Estou no cliente: usar GPS</button><button class="btn secondary" type="button" id="pinEdit">Ajustar pino no mapa</button></div>
 <div class="span2"><label class="fieldcheck"><input id="eliteFlag" type="checkbox"> Cliente Elite — visita em até 15 dias</label><label for="eliteReason">Motivo de ser Elite</label><input id="eliteReason" placeholder="Frota, compra prevista, negociação…"><p id="circuitHint"></p></div><div><label for="lastVisit">Última visita realizada</label><input id="lastVisit" type="date"></div><div><label>Histórico</label><button class="btn secondary" type="button" id="recordVisit">Registrar visita</button></div><div class="span2" id="visitHistory"></div>`);
populateCities=function(selected=''){$('city').value=selected||'';};
function refreshCircuitHint(){$('circuitHint').textContent='Circuito automático: '+(circuitOf($('city').value)?.name||'Definir circuito — cidade não mapeada');}
$('city').addEventListener('input',()=>{$('region').value=originalRegion($('city').value)||'UNMAPPED';refreshCircuitHint();});
const previousOpen=openAccount;
openAccount=function(id=''){
 editSession++;previousOpen(id);const a=state.accounts.find(a=>a.id===id)||{};
 for(const k of EXTRA)$(k).value=a[k]??'';
 if(!$('address').value)$('address').value=String(a.notes||'').match(/Endereço:\s*([^\n]+)/)?.[1]||'';
 $('eliteFlag').checked=a.elite===true;$('lookupStatus').textContent='';$('lastVisit').max=todayISO();refreshCircuitHint();
 $('visitHistory').innerHTML=(a.visits||[]).slice().reverse().map(v=>'<p>'+esc(fmt(v.date))+' — '+esc(v.note)+'</p>').join('');
};
saveAccount=function(e){
 e.preventDefault();if(!$('accountForm').reportValidity())return;
 const id=$('accountId').value||crypto.randomUUID(),old=state.accounts.find(a=>a.id===id),a={...old,id};
  for(const k of ['company','region','city','segment','priority','contact','role','phone','stage','value','trigger','nextAction','nextDate','fleet','intel','notes',...EXTRA])a[k]=$(k).value.trim();
 a.elite=$('eliteFlag').checked;a.visits=a.visits||[];
 if(a.elite&&!a.eliteReason){alert('Informe o motivo para acompanhar este cliente como Elite.');return;}
 if(a.lastVisit&&(!dateOK(a.lastVisit)||a.lastVisit>todayISO())){alert('A última visita deve ser uma data válida até hoje.');return;}
 if((a.latitude||a.longitude)&&!coords(a)){alert('Preencha latitude e longitude válidas.');return;}
 const cnpj=a.cnpj.replace(/[^a-z0-9]/gi,'').toUpperCase();
 if(cnpj&&state.accounts.some(x=>x.id!==id&&String(x.cnpj||'').replace(/[^a-z0-9]/gi,'').toUpperCase()===cnpj)){alert('Já existe outra conta com este CNPJ. Abra esse cadastro para atualizar.');return;}
 a.cnpj=cnpj;
 if(commit(normalizeV3({...state,accounts:old?state.accounts.map(x=>x.id===id?a:x):[...state.accounts,a]})))$('accountDialog').close();
};
const previousRender=renderAll;
renderAll=function(){previousRender();renderElite();if($('map').classList.contains('active'))renderMap();};
const previousShow=showSection;
showSection=function(id){previousShow(id);if(id==='elite')renderElite();if(id==='map')openMap();};
const previousCard=accountCard;
accountCard=function(a,s=false){return previousCard(a,s)+(a.elite?'<div class="elite-tag">★ Elite · '+esc(visitStatus(a))+' · '+esc(fmt(dueDate(a)))+'</div>':'');};
function renderElite(){
 const elite=state.accounts.filter(a=>a.elite),due=elite.filter(a=>!a.lastVisit||dueDate(a)<=todayISO());
 $('eliteSummary').textContent=elite.length+' Elite • '+due.length+' com visita pendente • '+elite.filter(a=>!circuitOf(a.city)).length+' sem circuito. Base: Londrina.';
 const filter=$('eliteCircuit').value,host=$('elitePlan');host.replaceChildren();
 const plans=CIRCUITS.map(c=>({c,...planCircuit(c)}));const totals={};
 plans.forEach(p=>p.slots.forEach(s=>{if(s.accounts.length)(totals[s.date]??=[]).push(p.c.name);}));
 for(const p of plans.filter(p=>!filter||p.c.id===filter)){
  if(!p.accounts.length)continue;const card=document.createElement('div');card.className='slot';card.innerHTML='<h3>'+esc(p.c.name)+' · '+p.accounts.length+' Elite</h3>';
  for(const slot of p.slots){const d=document.createElement('div');d.className='slot';d.innerHTML='<b>'+fmt(slot.date)+' · '+slot.accounts.length+'/'+slot.capacity+' visitas</b>';
   if((totals[slot.date]||[]).length>1)d.insertAdjacentHTML('beforeend','<p class="warning">Mais de um circuito neste dia: '+totals[slot.date].map(esc).join(', ')+'. Ajuste as janelas.</p>');
   for(const a of slot.accounts){const row=document.createElement('p');row.textContent=a.company+' — '+a.city+' · limite '+fmt(dueDate(a));d.append(row);if(slot.date>dueDate(a))d.insertAdjacentHTML('beforeend','<p class="warning">Exige antecipação: esta janela passa do limite de 15 dias. Reserve atendimento antes dela.</p>');d.append(button('Abrir cliente',()=>openAccount(a.id)));}
   if(!slot.accounts.length)d.append(document.createTextNode(' — espaço para outras visitas e prospecção'));card.append(d);
  }
  if(p.unplaced.length){const w=document.createElement('p');w.className='warning';w.textContent='Sem vaga nesta quinzena: '+p.unplaced.map(a=>a.company).join(', ')+'. Acrescente um dia ou ajuste a capacidade.';card.append(w);}host.append(card);
 }
 for(const a of elite.filter(a=>!circuitOf(a.city))){const p=document.createElement('p');p.textContent=a.company+' — '+a.city+': definir circuito';host.append(p,button('Abrir cliente',()=>openAccount(a.id)));}
 if(!elite.length)host.innerHTML='<p>Nenhum Elite confirmado. Abra uma conta ou avalie os candidatos abaixo.</p>';
 const candidates=state.accounts.filter(a=>!a.elite&&(!filter||circuitOf(a.city)?.id===filter)).map(a=>({a,...candidate(a)})).filter(x=>x.points>0).sort((a,b)=>b.points-a.points||a.a.company.localeCompare(b.a.company)),list=$('eliteCandidates');list.replaceChildren();
 for(const {a,reasons} of candidates){const d=document.createElement('div');d.className='slot';d.innerHTML='<strong>'+esc(a.company)+'</strong><p>'+esc(a.city)+' · '+esc(circuitOf(a.city)?.name||'Definir circuito')+'</p><p>'+reasons.map(esc).join('; ')+'.</p><p class="muted">Validar: frota própria, demanda/prazo, decisor e benefício de visita quinzenal.</p>';d.append(button('Avaliar cadastro',()=>openAccount(a.id)));list.append(d);}
 if(!candidates.length)list.textContent='Sem candidatos com indícios suficientes neste filtro.';
}
function setupCircuits(){
 const options=CIRCUITS.map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('');
 for(const id of ['eliteCircuit','mapCircuit'])$(id).innerHTML='<option value="">Todos os circuitos</option>'+options;
 $('mappingCircuit').innerHTML=options;$('cycleAnchor').value=state.cycleAnchor;
 $('eliteCircuit').onchange=renderElite;$('mapCircuit').onchange=renderMap;$('mapKind').onchange=renderMap;
 $('saveAnchor').onclick=()=>{const v=$('cycleAnchor').value;if(!dateOK(v)||monday(v)!==v){alert('Escolha uma segunda-feira.');return;}commit({...state,cycleAnchor:v});};
 $('saveMapping').onclick=()=>{const city=$('mappingCity').value.trim();if(!city)return;commit({...state,cityCircuit:{...state.cityCircuit,[normKey(city)]:$('mappingCircuit').value}});setupCircuits();alert('Cidade direcionada. Confira as vagas do circuito.');};
 const host=$('circuitConfig');host.replaceChildren();
 for(const c of CIRCUITS){const s=settingsFor(c),d=document.createElement('div');d.className='slot';d.innerHTML='<h3>'+esc(c.name)+'</h3><p>'+[...new Set([...allCities,...Object.keys(state.cityCircuit)])].filter(city=>circuitOf(city)?.id===c.id).map(esc).join(', ')+'</p><p>Marque os dias do giro:</p>';
  const checks=document.createElement('div');checks.className='daychecks';const inputs=[];
  for(let n=0;n<10;n++){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=n;input.checked=s.days.includes(n);label.append(input,document.createTextNode(' S'+(n<5?1:2)+' '+['Seg','Ter','Qua','Qui','Sex'][n%5]));checks.append(label);inputs.push(input);}
  const cap=document.createElement('input');cap.type='number';cap.min=1;cap.max=12;cap.value=s.capacity;cap.setAttribute('aria-label','Máximo de visitas por dia em '+c.name);
  d.append(checks,document.createTextNode('Máximo de visitas por dia; reduza conforme o tempo de estrada.'),cap,button('Salvar dias e capacidade',()=>{const days=inputs.filter(i=>i.checked).map(i=>Number(i.value)),capacity=Number(cap.value);if(!days.length||!Number.isInteger(capacity)||capacity<1||capacity>12){alert('Selecione dias e capacidade de 1 a 12.');return;}commit({...state,circuitSettings:{...state.circuitSettings,[c.id]:{days,capacity}}});}));host.append(d);
 }
}
const visitDialog=document.createElement('dialog');visitDialog.innerHTML='<div class="modalbody"><h2>Registrar visita</h2><form id="visitForm"><label for="visitDate">Data</label><input id="visitDate" type="date" required><label for="visitNote">Resultado e próximo passo</label><textarea id="visitNote" required></textarea><div class="btnrow"><button class="btn">Salvar visita</button><button class="btn secondary" type="button" id="cancelVisit">Cancelar</button></div></form></div>';document.body.append(visitDialog);
$('recordVisit').onclick=()=>{if(!$('accountId').value){alert('Salve a conta antes de registrar a visita.');return;}$('visitDate').value=todayISO();$('visitDate').max=todayISO();$('visitNote').value='';visitDialog.showModal();};
$('cancelVisit').onclick=()=>visitDialog.close();
$('visitForm').onsubmit=e=>{e.preventDefault();const date=$('visitDate').value,note=$('visitNote').value.trim(),id=$('accountId').value,a=state.accounts.find(a=>a.id===id);if(!a||!dateOK(date)||date>todayISO()||!note)return;
 const updated={...a,visits:[...(a.visits||[]),{id:crypto.randomUUID(),date,note}],lastVisit:dateOK(a.lastVisit)&&a.lastVisit>date?a.lastVisit:date};
 if(commit({...state,accounts:state.accounts.map(x=>x.id===id?updated:x)})){$('lastVisit').value=updated.lastVisit;$('visitHistory').textContent=updated.visits.map(v=>fmt(v.date)+' — '+v.note).join(' | ');visitDialog.close();}};
function cleanCnpj(value){return String(value||'').replace(/[^a-z0-9]/gi,'').toUpperCase().slice(0,14);}
function formatCnpj(value){const c=cleanCnpj(value);return c.length===14?c.slice(0,2)+'.'+c.slice(2,5)+'.'+c.slice(5,8)+'/'+c.slice(8,12)+'-'+c.slice(12):c;}
function cnpjCheckDigit(base,weights){let sum=0;for(let i=0;i<weights.length;i++)sum+=(base.charCodeAt(i)-48)*weights[i];const rest=sum%11;return rest<2?0:11-rest;}
function validCnpj(cnpj){
 if(!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)||/^([A-Z0-9])\1{13}$/.test(cnpj))return false;
 const d1=cnpjCheckDigit(cnpj.slice(0,12),[5,4,3,2,9,8,7,6,5,4,3,2]);
 const d2=cnpjCheckDigit(cnpj.slice(0,12)+d1,[6,5,4,3,2,9,8,7,6,5,4,3,2]);
 return cnpj.slice(12)===String(d1)+String(d2);
}
$('cnpj').setAttribute('maxlength','18');$('cnpj').setAttribute('autocapitalize','characters');$('cnpj').setAttribute('spellcheck','false');
$('cnpj').addEventListener('blur',()=>{const c=cleanCnpj($('cnpj').value);if(c)$('cnpj').value=formatCnpj(c);});
async function fetchJSON(url,timeoutMs=15000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const r=await fetch(url,{signal:controller.signal,cache:'no-store',headers:{Accept:'application/json'}});
  let data=null;try{data=await r.json();}catch(e){}
  if(!r.ok){const err=Error(data?.message||data?.titulo||data?.detalhes||'Consulta indisponível ('+r.status+').');err.status=r.status;throw err;}
  if(!data||typeof data!=='object')throw Error('A consulta retornou dados inválidos.');
  return data;
 }catch(e){
  if(e.name==='AbortError'){const err=Error('A consulta demorou além do esperado.');err.code='TIMEOUT';throw err;}
  throw e;
 }finally{clearTimeout(timer);}
}
function normalizedBrasilApi(data){
 return {source:'BrasilAPI',legalName:data.razao_social||'',company:data.nome_fantasia||data.razao_social||'',
  address:[data.descricao_tipo_de_logradouro,data.logradouro,data.numero,data.complemento,data.bairro,data.municipio,data.uf,data.cep].filter(Boolean).join(', '),
  postcode:String(data.cep||'').replace(/\D/g,''),cnae:[data.cnae_fiscal,data.cnae_fiscal_descricao].filter(Boolean).join(' — '),
  email:data.email||'',phone:data.ddd_telefone_1||'',city:data.municipio||'',uf:data.uf||'',status:data.descricao_situacao_cadastral||''};
}
function normalizedCnpjWs(data){
 const e=data.estabelecimento||{},activity=e.atividade_principal||{},city=e.cidade||{},stateInfo=e.estado||{};
 return {source:'CNPJ.ws',legalName:data.razao_social||'',company:e.nome_fantasia||data.razao_social||'',
  address:[e.tipo_logradouro,e.logradouro,e.numero,e.complemento,e.bairro,city.nome,stateInfo.sigla,e.cep].filter(Boolean).join(', '),
  postcode:String(e.cep||'').replace(/\D/g,''),cnae:[activity.id,activity.descricao].filter(Boolean).join(' — '),
  email:e.email||'',phone:[e.ddd1,e.telefone1].filter(Boolean).join(' '),city:city.nome||'',uf:stateInfo.sigla||'',status:e.situacao_cadastral||''};
}
async function fetchCompany(cnpj,session){
 const brasil={name:'BrasilAPI',url:'https://brasilapi.com.br/api/cnpj/v1/'+encodeURIComponent(cnpj),normalize:normalizedBrasilApi};
 const cnpjws={name:'CNPJ.ws',url:'https://publica.cnpj.ws/cnpj/'+encodeURIComponent(cnpj),normalize:normalizedCnpjWs};
 const sources=/[A-Z]/.test(cnpj)?[cnpjws,brasil]:[brasil,cnpjws],errors=[];
 for(let i=0;i<sources.length;i++){
  if(session!==editSession||!$('accountDialog').open)throw Object.assign(Error('Consulta cancelada.'),{code:'CANCELLED'});
  $('lookupStatus').textContent='Consultando dados cadastrais… tentativa '+(i+1)+' de '+sources.length+'.';
  try{
   const raw=await fetchJSON(sources[i].url,12000),company=sources[i].normalize(raw);
   if(!company.legalName)throw Error('A base não retornou razão social.');
   return company;
  }catch(e){errors.push({source:sources[i].name,status:e.status,code:e.code,message:e.message});}
 }
 const err=Error('Não foi possível localizar este CNPJ.');
 err.attempts=errors;throw err;
}
function lookupFailureMessage(err){
 const attempts=err.attempts||[];
 if(navigator.onLine===false)return 'Sem conexão com a internet. Conecte-se e tente novamente.';
 if(attempts.length&&attempts.every(x=>x.status===404))return 'CNPJ não encontrado nas duas bases. Confira os 14 caracteres.';
 if(attempts.some(x=>x.status===429))return 'Uma das bases limitou as consultas. Aguarde um minuto e tente novamente.';
 if(attempts.some(x=>x.code==='TIMEOUT'))return 'As bases demoraram para responder. Confira a internet e tente novamente.';
 return 'As duas bases de consulta estão indisponíveis agora. Você ainda pode preencher os dados manualmente.';
}
$('lookupCnpj').onclick=async()=>{
 if(lookupBusy)return;const cnpj=cleanCnpj($('cnpj').value);$('cnpj').value=formatCnpj(cnpj);
 if(!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)){$('lookupStatus').textContent='Informe os 14 caracteres do CNPJ.';return;}
 if(!validCnpj(cnpj)){$('lookupStatus').textContent='CNPJ inválido. Confira os caracteres e os dois dígitos finais.';return;}
 const session=editSession;lookupBusy=true;$('lookupCnpj').disabled=true;$('lookupStatus').textContent='Consultando dados cadastrais…';
 try{
  const data=await fetchCompany(cnpj,session);
  if(session!==editSession||!$('accountDialog').open||cleanCnpj($('cnpj').value)!==cnpj)return;
  if(($('company').value||$('address').value)&&!confirm('Aplicar os dados cadastrais encontrados? O endereço da visita e as anotações serão preservados.'))return;
  $('legalName').value=data.legalName;$('company').value=data.company;
  $('address').value=data.address;$('postcode').value=data.postcode;$('cnae').value=data.cnae;
  if(!$('email').value)$('email').value=data.email;if(!$('phone').value)$('phone').value=data.phone;
  $('city').value=allCities.find(c=>normKey(c)===normKey(data.city))||data.city||'';
  $('region').value=data.uf==='PR'?(originalRegion($('city').value)||'UNMAPPED'):'UNMAPPED';
  if(data.uf&&data.uf!=='PR')$('city').value=(data.city||'')+' / '+data.uf;
  refreshCircuitHint();
  $('lookupStatus').textContent='Dados encontrados via '+data.source+(data.status?' • situação: '+data.status:'')+'. Confira e salve.';
  if(!$('latitude').value&&!$('longitude').value&&!$('visitAddress').value&&/^\d{8}$/.test($('postcode').value)){
   try{
    const requestedCep=$('postcode').value,cep=await fetchJSON('https://brasilapi.com.br/api/cep/v2/'+requestedCep);
    if(session!==editSession||!$('accountDialog').open||$('postcode').value!==requestedCep||$('latitude').value||$('longitude').value||$('visitAddress').value)return;
    const p=cep.location?.coordinates||{};
    if(coords({latitude:p.latitude,longitude:p.longitude})){$('latitude').value=p.latitude;$('longitude').value=p.longitude;$('geoStatus').value='approximate';$('lookupStatus').textContent+=' Posição aproximada pelo CEP preenchida; confira o pino.';}
    else $('lookupStatus').textContent+=' O CEP foi encontrado, mas sem coordenadas; ajuste o pino ou use o GPS.';
   }catch(e){if(session===editSession)$('lookupStatus').textContent+=' Não foi possível localizar o CEP; ajuste o pino ou use o GPS.';}
  }
 }catch(e){
  if(e.code!=='CANCELLED'&&session===editSession)$('lookupStatus').textContent=lookupFailureMessage(e);
 }finally{lookupBusy=false;$('lookupCnpj').disabled=false;}
};
$('useGps').onclick=()=>{const session=editSession;if(!navigator.geolocation){alert('GPS indisponível.');return;}navigator.geolocation.getCurrentPosition(p=>{if(session!==editSession)return;$('latitude').value=p.coords.latitude;$('longitude').value=p.coords.longitude;$('geoStatus').value='gps';$('lookupStatus').textContent='GPS preenchido (precisão informada: '+Math.round(p.coords.accuracy)+' m). Salve a conta.';},()=>alert('Não foi possível obter sua localização. Confira a permissão do GPS.'),{enableHighAccuracy:true,timeout:15000});};
async function loadLeaflet(){
 if(window.L)return true;if(leafletPromise)return leafletPromise;
 leafletPromise=new Promise(resolve=>{const css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';css.integrity='sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';css.crossOrigin='';document.head.append(css);
 const s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.integrity='sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';s.crossOrigin='';const timer=setTimeout(()=>resolve(false),15000);s.onload=()=>{clearTimeout(timer);resolve(true);};s.onerror=()=>{clearTimeout(timer);resolve(false);};document.head.append(s);});
 const ok=await leafletPromise;if(!ok)leafletPromise=null;return ok;
}
function tiles(map){L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);}
async function openMap(){$('mapStatus').textContent='Abrindo mapa…';if(!await loadLeaflet()){renderMap();return;}if(!visitMap){visitMap=L.map('visitMap').setView([-23.15,-50.75],8);tiles(visitMap);markerLayer=L.featureGroup().addTo(visitMap);}visitMap.invalidateSize();renderMap();}
function renderMap(){
 const circuit=$('mapCircuit').value,kind=$('mapKind').value,accounts=state.accounts.filter(a=>(!circuit||circuitOf(a.city)?.id===circuit)&&(kind==='all'||kind==='elite'&&a.elite||kind==='due'&&a.elite&&(!a.lastVisit||dueDate(a)<=todayISO())||kind==='missing'&&!coords(a))),mapped=accounts.filter(coords);
 $('mapStatus').textContent=(visitMap?'':'Mapa de ruas indisponível; confira a internet. ')+mapped.length+' com posição • '+(accounts.length-mapped.length)+' sem posição neste filtro.';
 if(markerLayer){markerLayer.clearLayers();for(const a of mapped){const approximate=!['confirmed','manual','gps'].includes(a.geoStatus),color=approximate?'#d8b74c':a.elite?dueDate(a)<=todayISO()?'#e65757':'#ff7a00':'#579dee',popup=document.createElement('div'),title=document.createElement('strong'),p=document.createElement('p');title.textContent=a.company;p.textContent=a.city+' · '+(approximate?'Posição aproximada — conferir':a.geoStatus==='gps'?'GPS registrado':'Posição ajustada/confirmada');popup.append(title,p,button('Abrir cadastro',()=>openAccount(a.id)));const link=document.createElement('a');link.textContent='Abrir navegação';link.href='https://www.google.com/maps/dir/?api=1&destination='+coords(a).join(',');link.target='_blank';link.rel='noopener';popup.append(document.createElement('br'),link);L.circleMarker(coords(a),{radius:a.elite?10:7,color,fillColor:color,fillOpacity:.8}).bindPopup(popup).addTo(markerLayer);}if(mapped.length)visitMap.fitBounds(markerLayer.getBounds(),{padding:[30,30],maxZoom:13});}
 const list=$('mapList');list.replaceChildren();for(const a of accounts){const d=document.createElement('div');d.className='account';d.textContent=a.company+' — '+a.city+' · '+(coords(a)?'Com posição':'Sem localização');d.append(document.createElement('br'),button('Abrir cadastro',()=>openAccount(a.id)));list.append(d);}
}
const pinDialog=document.createElement('dialog');pinDialog.innerHTML='<div class="modalbody"><h3>Ajustar posição de visita</h3><p>Toque no local ou arraste o pino. O mapa original do território é uma referência sem coordenadas geográficas.</p><div id="pinMap" style="height:45vh;min-height:300px"></div><div class="btnrow"><button class="btn" id="applyPin">Usar este ponto</button><button class="btn secondary" id="cancelPin">Cancelar</button></div></div>';document.body.append(pinDialog);let pinMap,pin,pinChosen=false;
$('pinEdit').onclick=async()=>{if(!await loadLeaflet()){alert('Não foi possível carregar o mapa. Confira a internet ou informe as coordenadas.');return;}const current=coords({latitude:$('latitude').value,longitude:$('longitude').value});pinChosen=!!current;pinDialog.showModal();if(!pinMap){pinMap=L.map('pinMap').setView([-23.3,-51.16],10);tiles(pinMap);pin=L.marker([-23.3,-51.16],{draggable:true}).addTo(pinMap);pin.on('dragend',()=>pinChosen=true);pinMap.on('click',e=>{pin.setLatLng(e.latlng);pinChosen=true;});}pin.setLatLng(current||[-23.3,-51.16]);pinMap.setView(current||[-23.3,-51.16],current?15:9);pinMap.invalidateSize();};
$('cancelPin').onclick=()=>pinDialog.close();$('applyPin').onclick=()=>{if(!pinChosen){alert('Toque no local do cliente antes de confirmar.');return;}const p=pin.getLatLng();$('latitude').value=p.lat.toFixed(7);$('longitude').value=p.lng.toFixed(7);$('geoStatus').value='manual';pinDialog.close();};
importBackup=function(ev){const f=ev.target.files[0];if(!f)return;const reader=new FileReader();reader.onload=()=>{try{const raw=JSON.parse(reader.result);if(!raw||!Array.isArray(raw.accounts)||raw.accounts.some(a=>!a||typeof a.company!=='string'||typeof a.city!=='string'||typeof a.id!=='string'))throw Error();if(!confirm('Restaurar '+raw.accounts.length+' contas? Os dados atuais serão substituídos; uma cópia anterior ficará neste aparelho.'))return;localStorage.setItem(KEY+'_before_restore',JSON.stringify(state));if(commit(normalizeV3(raw))){setupCircuits();alert('Backup restaurado, incluindo os campos antigos.');}}catch(e){alert('Não foi possível importar: arquivo inválido ou armazenamento indisponível.');}ev.target.value='';};reader.readAsText(f);};
$('settings').insertAdjacentHTML('afterbegin','<div class="card"><h3>V3 — Elite e mapa</h3><p>Os dados continuam neste aparelho. Guarde seu backup fora do aplicativo. Consultas de CNPJ/CEP usam <a href="https://brasilapi.com.br/docs" target="_blank" rel="noopener">BrasilAPI</a>. A posição por CEP é aproximada e pode não estar disponível.</p><button class="btn secondary" id="restorePrevious">Recuperar cópia anterior à última importação</button></div>');
$('restorePrevious').onclick=()=>{const data=localStorage.getItem(KEY+'_before_restore');if(!data){alert('Não há cópia anterior neste aparelho.');return;}if(confirm('Recuperar os dados anteriores à última importação?')){try{commit(normalizeV3(JSON.parse(data)));setupCircuits();}catch(e){alert('Não foi possível recuperar.');}}};
resetApp=function(){if(confirm('Apagar todas as contas e oportunidades deste aparelho? Exporte um backup antes.')){commit(normalizeV3(structuredClone(defaultState)));setupCircuits();}};
setupCircuits();renderAll();
