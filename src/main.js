import './styles.css';

/* ═══ ESTADO GLOBAL ═══ */
var V={}, SD={0:{},1:{},2:{}};
var userName='',userShift='',userRole='';
var curSec=0,curSub=0;
var CA={1:true,2:true,3:true,4:true,5:true,6:false,7:false};
var GR={};
var charts={};
var fGrid=null,fRow=0,fCol=0;
var jumpTimer=null;
var nowH=new Date().getHours();
var curH=(nowH%8)+1;
var H8=[1,2,3,4,5,6,7,8];
var H4=[2,4,6,8];
var _syncTimer=null;
var _lastSyncTs=0;

// Exponer V globalmente para inline handlers
window.V=V;

/* ═══ CFG — PARÁMETROS DINÁMICOS (editables por Jefe) ═══ */
var CFG_DEFAULT={
  gran_ok:90,
  prim_lo:74,   prim_hi:75,
  sec_lo:75,    sec_hi:78,
  alim_ok_lo:48,alim_ok_hi:52,alim_warn_lo:47,alim_warn_hi:53,
  sol_bad:10,   sol_warn:14,  sol_ok:21,
  pas_bad:74,   pas_warn:79,  pas_ok:85,
  cn_bad_lo:0.60,cn_warn_lo:1.0,cn_ok_hi:1.50,cn_warn_hi:1.70,
  ph_ok_lo:10.5,ph_ok_hi:11.5,ph_warn_lo:10,ph_warn_hi:12,
  esp1_lo:47,   esp1_hi:53,
  esp89_lo:52,  esp89_hi:58,
  ag6_ok_lo:47, ag6_ok_hi:48, ag6_warn_hi:49,
  ag0m200_bad:78,ag0m200_warn:79,ag0m200_ok:85,
  ag0cn_bad:1.5,ag0cn_warn:2.5,ag0cn_ok:5.5,
  ag0o2_bad:5,  ag0o2_ok:12,
  ag0ph_lo:10.5,ag0ph_hi:12,
  turb_in_w1:10,turb_in_ok:40,turb_in_w2:50,
  turb_out_ok:3,turb_out_warn:4,
  barren_ok:0.1,
  esplab_ok:0.2
};
var CFG=JSON.parse(JSON.stringify(CFG_DEFAULT));
function cargarCFG(){try{var s=localStorage.getItem('hemco_cfg');if(s){var c=JSON.parse(s);Object.assign(CFG,c);}}catch(e){}}
function guardarCFG(){try{localStorage.setItem('hemco_cfg',JSON.stringify(CFG));}catch(e){}}
cargarCFG();

/* ═══ FÓRMULAS ═══ */
function cmToM3h(cm){if(!cm||isNaN(+cm)||+cm<=0)return null;return(3600*0.832*Math.pow(+cm/100,2.5)).toFixed(2);}
function pbToTph(v){if(!v||isNaN(+v)||+v<=0)return null;return(+v*6.223543276).toFixed(1);}

function calcCCvals(){
  var Al=parseFloat(V['cc_alim_sol'])||null,AlM=parseFloat(V['cc_alim_m200'])||null;
  var act=[];for(var c=1;c<=7;c++){if(CA[c])act.push(c);}
  function avg(a){return a.length>0?a.reduce(function(x,y){return x+y;},0)/a.length:null;}
  var of=[],uf=[],om=[],um=[];
  for(var j=0;j<act.length;j++){var ci=act[j];
    var os=parseFloat(V['cc_c'+ci+'_os']);if(!isNaN(os))of.push(os);
    var us=parseFloat(V['cc_c'+ci+'_us']);if(!isNaN(us))uf.push(us);
    var ov=parseFloat(V['cc_c'+ci+'_om']);if(!isNaN(ov))om.push(ov);
    var uv=parseFloat(V['cc_c'+ci+'_um']);if(!isNaN(uv))um.push(uv);
  }
  var OF=avg(of),UF=avg(uf),OFm=avg(om),UFm=avg(um);
  var cs=null,cm2=null;
  if(Al&&OF&&UF&&OF!==0&&UF!==0&&Al!==0){var d=(1/Al)-(1/UF);if(d!==0)cs=+(((1/OF)-(1/Al))/d*100).toFixed(1);}
  if(AlM!==null&&OFm!==null&&UFm!==null){var d2=AlM-UFm;if(d2!==0)cm2=+((OFm-AlM)/d2*100).toFixed(1);}
  return{sol:cs,mal:cm2};
}

/* ═══ ONZAS — BUG FIX #3: porCorte = producción individual; acum = progresivo ═══ */
function calcOzasAcum(){
  var running=0, res={porCorte:{},acum:{}};
  H4.forEach(function(hh){
    var pC=parseFloat(V['s3_pregC_h'+hh]);
    var bC=parseFloat(V['s3_barC_h'+hh]);
    var qMin=cmToM3h(V['s3_ton_min_h'+hh]);
    var qMax=cmToM3h(V['s3_ton_max_h'+hh]);
    if(!isNaN(pC)&&!isNaN(bC)&&qMin&&qMax&&pC>=bC){
      var oz=(pC-bC)*(+qMin+ +qMax)/31.1035;
      running+=oz;
      res.porCorte['h'+hh]=+oz.toFixed(1);      // producción de ESE bihora
      res.acum['h'+hh]=+running.toFixed(1);      // suma progresiva
    }
  });
  return res;
}

function calcTotalOz(){
  var d=calcOzasAcum(), keys=Object.keys(d.acum);
  return keys.length>0?d.acum[keys[keys.length-1]]:null;
}

/* ═══ FLUJÓMETRO CONO DE ZINC — cálculo paralelo de auditoría ═══ */
function calcOzasFluj(){
  var running=0, res={porCorte:{},acum:{},deltas:{}};
  var prev=parseFloat(V['fluj_h0']);
  var H4ref=[2,4,6,8];
  H4ref.forEach(function(hh){
    var lect=parseFloat(V['fluj_h'+hh]);
    if(!isNaN(prev)&&!isNaN(lect)&&lect>=prev){
      var delta=lect-prev;
      res.deltas['h'+hh]=+delta.toFixed(2);
      var pC=parseFloat(V['s3_pregC_h'+hh]);
      var bC=parseFloat(V['s3_barC_h'+hh]);
      if(!isNaN(pC)&&!isNaN(bC)&&pC>=bC){
        var oz=(pC-bC)*delta/31.1035;
        running+=oz;
        res.porCorte['h'+hh]=+oz.toFixed(1);
        res.acum['h'+hh]=+running.toFixed(1);
      }
      prev=lect;
    } else if(!isNaN(lect)){
      prev=lect;
    }
  });
  return res;
}
function calcTotalOzFluj(){
  var d=calcOzasFluj(), keys=Object.keys(d.acum);
  return keys.length>0?d.acum[keys[keys.length-1]]:null;
}

function calcRecupCortes(){
  var vals=[], res={};
  H4.forEach(function(hh){
    var pC=parseFloat(V['s3_pregC_h'+hh]);
    var bC=parseFloat(V['s3_barC_h'+hh]);
    if(!isNaN(pC)&&!isNaN(bC)&&pC>0){
      var r=((pC-bC)/pC*100);
      vals.push(r);
      res['h'+hh]=r.toFixed(1);
    }
  });
  var prom=vals.length>0?(vals.reduce(function(a,b){return a+b;},0)/vals.length).toFixed(1):null;
  return{prom:prom,cortes:res};
}

function getLastH4(rid){
  for(var i=H4.length-1;i>=0;i--){
    var v=parseFloat(V[rid+'_h'+H4[i]]);
    if(!isNaN(v))return v;
  }
  return null;
}

/* ═══ STATUS — leen de CFG (editables) ═══ */
function sGran(v){if(!v||isNaN(+v))return'';return +v>=CFG.gran_ok?'ok':'bad';}
function sPrim(v){if(!v||isNaN(+v))return'';var n=+v;return n>=CFG.prim_lo&&n<=CFG.prim_hi?'ok':(n>=CFG.prim_lo-1&&n<=CFG.prim_hi+1?'warn':'bad');}
function sSec(v){if(!v||isNaN(+v))return'';var n=+v;return n>=CFG.sec_lo&&n<=CFG.sec_hi?'ok':(n>=CFG.sec_lo-1&&n<=CFG.sec_hi+1?'warn':'bad');}
function sAlim(v){if(!v||isNaN(+v))return'';var n=+v;if(n>=CFG.alim_ok_lo&&n<=CFG.alim_ok_hi)return'ok';if(n<CFG.alim_warn_lo||n>CFG.alim_warn_hi)return'bad';return'warn';}
function sSol(v){if(!v||isNaN(+v))return'';var n=+v;if(n<CFG.sol_bad)return'bad';if(n<=CFG.sol_warn)return'warn';if(n<=CFG.sol_ok)return'ok';return'warn';}
function sPas(v){if(!v||isNaN(+v))return'';var n=+v;if(n<CFG.pas_bad)return'bad';if(n<=CFG.pas_warn)return'warn';if(n<=CFG.pas_ok)return'ok';return'warn';}
function sCN(v){if(!v||isNaN(+v))return'';var n=+v;if(n<CFG.cn_bad_lo)return'bad';if(n<CFG.cn_warn_lo)return'warn';if(n<=CFG.cn_ok_hi)return'ok';if(n<=CFG.cn_warn_hi)return'warn';return'bad';}
function sPH(v){if(!v||isNaN(+v))return'';var n=+v;return n>=CFG.ph_ok_lo&&n<=CFG.ph_ok_hi?'ok':(n>=CFG.ph_warn_lo&&n<=CFG.ph_warn_hi?'warn':'bad');}
function sFree(v){if(!v||isNaN(+v))return'';return'ok';}
function sEsp1(v){if(!v||isNaN(+v))return'';var n=+v;if(n<CFG.esp1_lo)return'bad';if(n<=CFG.esp1_hi)return'ok';return'bad';}
function sEsp89(v){if(!v||isNaN(+v))return'';var n=+v;if(n<CFG.esp89_lo)return'bad';if(n<=CFG.esp89_hi)return'ok';return'bad';}
function sAg6(v){if(!v||isNaN(+v))return'';var n=+v;if(n<CFG.ag6_ok_lo)return'bad';if(n<=CFG.ag6_ok_hi)return'ok';if(n<=CFG.ag6_warn_hi)return'warn';return'bad';}
function sAg0M200(v){if(!v||isNaN(+v))return'';var n=+v;if(n<CFG.ag0m200_bad)return'bad';if(n<CFG.ag0m200_warn)return'warn';if(n<=CFG.ag0m200_ok)return'ok';return'warn';}
function sAg0CN(v){if(!v||isNaN(+v))return'';var n=+v;if(n<CFG.ag0cn_bad)return'bad';if(n<CFG.ag0cn_warn)return'warn';if(n<=CFG.ag0cn_ok)return'ok';return'warn';}
function sAg0O2(v){if(!v||isNaN(+v))return'';var n=+v;if(n<CFG.ag0o2_bad)return'bad';if(n<=CFG.ag0o2_ok)return'ok';return'warn';}
function sAg0pH(v){if(!v||isNaN(+v))return'';var n=+v;if(n<CFG.ag0ph_lo)return'bad';if(n<=CFG.ag0ph_hi)return'ok';return'warn';}
function sTurbIn(v){if(!v||isNaN(+v))return'';var n=+v;if(n<=CFG.turb_in_w1)return'warn';if(n<=CFG.turb_in_ok)return'ok';if(n<=CFG.turb_in_w2)return'warn';return'bad';}
function sTurbOut(v){if(!v||isNaN(+v))return'';var n=+v;if(n<CFG.turb_out_ok)return'ok';if(n<=CFG.turb_out_warn)return'warn';return'bad';}
function sBarren(v){if(!v||isNaN(+v))return'';return +v<CFG.barren_ok?'ok':'bad';}
function sEspLab(v){if(!v||isNaN(+v))return'';return +v<CFG.esplab_ok?'ok':'bad';}

var FNS={sGran:sGran,sPrim:sPrim,sSec:sSec,sAlim:sAlim,sSol:sSol,sPas:sPas,sCN:sCN,sPH:sPH,sFree:sFree,sEsp1:sEsp1,sEsp89:sEsp89,sAg6:sAg6,sAg0M200:sAg0M200,sAg0CN:sAg0CN,sAg0O2:sAg0O2,sAg0pH:sAg0pH,sTurbIn:sTurbIn,sTurbOut:sTurbOut,sBarren:sBarren,sEspLab:sEspLab};

/* ═══ BUILDERS ═══ */
function mk(id,lbl,unit,fn,dis){
  var v=V[id]||'',s=fn(v);
  if(dis)return '<div class="fcard"><div class="flbl">'+lbl+'</div><div class="frow"><input type="number" class="fi" disabled placeholder="---"><span class="fu">'+unit+'</span></div></div>';
  return '<div class="fcard"><div class="flbl">'+lbl+'</div><div class="frow">'+
    '<input type="number" class="fi '+s+'" id="fi-'+id+'" value="'+v+'" placeholder="---" inputmode="decimal" oninput="sv(\''+id+'\',this.value,\''+fn.name+'\')">'+
    '<span class="fu">'+unit+'</span><div class="fdot '+s+'" id="fd-'+id+'"></div></div></div>';
}
function sv(id,v,fnName){
  var fn=FNS[fnName]||sFree;
  V[id]=v;var s=fn(v);
  var i=document.getElementById('fi-'+id),d=document.getElementById('fd-'+id);
  if(i)i.className='fi '+(s||'');if(d)d.className='fdot '+(s||'');
  if(id.indexOf('cc_')===0)calcCC();
  if(id==='pb_13a'){var t=document.getElementById('tph-13a');if(t)t.textContent=pbToTph(v)||'—';}
  if(id==='pb_13'){var t2=document.getElementById('tph-13');if(t2)t2.textContent=pbToTph(v)||'—';}
  programarSyncNube();
}
function gl(t,f){return '<div class="glbl">'+t+(f?'<span class="gf">'+f+'</span>':'')+'</div>';}
function gHead(hrs){var h='';for(var i=0;i<hrs.length;i++)h+='<th class="'+(hrs[i]===curH?'cur':'')+'">H'+hrs[i]+'</th>';return h;}
function hr(rid,lbl,unit,hrs,fn,step,ri,blk){
  step=step||'any';blk=blk||[];
  var c='<td class="rl">'+lbl+'</td><td class="uc">'+unit+'</td>';
  for(var j=0;j<hrs.length;j++){
    var h=hrs[j],k=rid+'_h'+h,ic=(h===curH),isB=(blk.indexOf(h)>=0);
    if(isB){c+='<td class="blk'+(ic?' cur':'')+'"></td>';}
    else{
      var v=V[k]||'',s=fn(v);
      c+='<td class="'+(ic?'cur ':'')+s+'" id="td-'+k+'">'+
        '<input type="number" step="'+step+'" inputmode="decimal" class="hi '+s+'" id="hgi-'+k+'" value="'+v+'" '+
        'onfocus="onGF(\''+rid+'\','+ri+','+j+')" '+
        'oninput="onCI(\''+k+'\',this.value,\''+fn.name+'\','+h+',\''+rid+'\','+ri+','+j+')">'+
        '</td>';
    }
  }
  return '<tr id="tr-'+rid+'-'+ri+'">'+c+'</tr>';
}

/* ═══ NAVIGATION ═══ */
function onCI(k,v,fnName,h,rid,ri,ci){
  var fn=FNS[fnName]||sFree;
  V[k]=v;var s=fn(v);
  var inp=document.getElementById('hgi-'+k),cell=document.getElementById('td-'+k);
  if(inp)inp.className='hi '+(s||'');
  if(cell)cell.className=(h===curH?'cur ':'')+s;
  if(k.indexOf('cc_')===0)calcCC();
  clearTimeout(window._at);
  if(v!==''&&!isNaN(+v)){
    window._at=setTimeout(function(){doAdvance(rid,ri,ci);},1000);
  }
  programarSyncNube();
}
function doAdvance(rid,ri,ci){
  var reg=GR[rid];if(!reg)return;
  var nr=ri+1;
  while(nr<reg.length){
    var id=reg[nr]&&reg[nr][ci];
    if(id){var el=document.getElementById(id);if(el&&!el.disabled){el.focus();el.select&&el.select();el.scrollIntoView({block:'nearest'});fRow=nr;hlRow(rid,nr);return;}}
    nr++;
  }
  checkColDone(rid,ci);
}
function onGF(g,r,c){fGrid=g;fRow=r;fCol=c;document.getElementById('nav-arrows').style.display='flex';hlRow(g,r);}
function hlRow(g,r){document.querySelectorAll('.hgrid tr.arow').forEach(function(t){t.classList.remove('arow');});var t=document.getElementById('tr-'+g+'-'+r);if(t)t.classList.add('arow');}
function navUp(){if(!fGrid)return;var reg=GR[fGrid];if(!reg)return;var pr=fRow-1;while(pr>=0){var id=reg[pr]&&reg[pr][fCol];if(id){var el=document.getElementById(id);if(el&&!el.disabled){el.focus();el.select&&el.select();el.scrollIntoView({block:'nearest'});fRow=pr;hlRow(fGrid,pr);return;}}pr--;}}
function navDown(){if(!fGrid)return;var reg=GR[fGrid];if(!reg)return;var nr=fRow+1;while(nr<reg.length){var id=reg[nr]&&reg[nr][fCol];if(id){var el=document.getElementById(id);if(el&&!el.disabled){el.focus();el.select&&el.select();el.scrollIntoView({block:'nearest'});fRow=nr;hlRow(fGrid,nr);return;}}nr++;}checkColDone(fGrid,fCol);}
function checkColDone(rid,ci){
  var reg=GR[rid];if(!reg)return;
  var all=true;
  for(var r=0;r<reg.length;r++){var id=reg[r]&&reg[r][ci];if(id){var el=document.getElementById(id);if(el&&!el.value){all=false;break;}}}
  if(!all)return;
  var col=reg[0]&&reg[0][ci]?reg[0][ci].replace(/.*_h/,''):'';
  var msg=document.getElementById('col-toast-msg');
  if(msg)msg.innerHTML='✓ H'+col+' completa — ¿Siguiente subsección?';
  document.getElementById('col-toast').className='col-toast show';
  clearTimeout(jumpTimer);jumpTimer=setTimeout(doJump,5000);
}
function doJump(){clearTimeout(jumpTimer);document.getElementById('col-toast').className='col-toast';SD[curSec][curSub]=true;var s=SECS[curSec].subs;if(curSub<s.length-1)goSub(curSub+1);else{renderTiles();goToDash();}}
function cancelJump(){clearTimeout(jumpTimer);document.getElementById('col-toast').className='col-toast';}
function regGrid(id,rows){setTimeout(function(){GR[id]=rows;},60);}
function mkR(rid,hrs){return hrs.map(function(h){return'hgi-'+rid+'_h'+h;});}

/* ═══ CC ═══ */
function calcCC(){
  var Al=parseFloat(V['cc_alim_sol'])||null,AlM=parseFloat(V['cc_alim_m200'])||null;
  var act=[];for(var c=1;c<=7;c++){if(CA[c])act.push(c);}
  function avg(a){return a.length>0?a.reduce(function(x,y){return x+y;},0)/a.length:null;}
  var of=[],uf=[],om=[],um=[];
  for(var j=0;j<act.length;j++){var ci=act[j];
    var os=parseFloat(V['cc_c'+ci+'_os']);if(!isNaN(os))of.push(os);
    var us=parseFloat(V['cc_c'+ci+'_us']);if(!isNaN(us))uf.push(us);
    var ov=parseFloat(V['cc_c'+ci+'_om']);if(!isNaN(ov))om.push(ov);
    var uv=parseFloat(V['cc_c'+ci+'_um']);if(!isNaN(uv))um.push(uv);
  }
  var OF=avg(of),UF=avg(uf),OFm=avg(om),UFm=avg(um);
  var cs='—',cm='—';
  if(Al&&OF&&UF&&OF!==0&&UF!==0&&Al!==0){var d=(1/Al)-(1/UF);if(d!==0)cs=(((1/OF)-(1/Al))/d*100).toFixed(1)+'%';}
  if(AlM!==null&&OFm!==null&&UFm!==null){var d2=AlM-UFm;if(d2!==0)cm=((OFm-AlM)/d2*100).toFixed(1)+'%';}
  var e1=document.getElementById('cc-sol'),e2=document.getElementById('cc-mal');
  if(e1)e1.textContent=cs;if(e2)e2.textContent=cm;
}
function rCic(){
  var h='<table class="ctbl"><thead><tr><th class="cl">Ciclón</th><th>Activo</th><th>Over %Sol</th><th>Over M200</th><th>Under %Sol</th><th>Under M200</th></tr></thead><tbody>';
  for(var c=1;c<=7;c++){var on=CA[c];
    h+='<tr><td class="cl">Ciclón #'+c+'</td><td><button class="tog '+(on?'on':'')+'" onclick="togC('+c+')">'+(on?'●':'○')+'</button></td>';
    if(on){var ts=['os','om','us','um'];for(var ti=0;ti<ts.length;ti++){var k='cc_c'+c+'_'+ts[ti];h+='<td><input type="number" inputmode="decimal" class="hi" style="width:100%" value="'+(V[k]||'')+'" oninput="V[\''+k+'\']=this.value;calcCC()"></td>';}}
    else{h+='<td class="ia" colspan="4">—</td>';}
    h+='</tr>';
  }
  return h+'</tbody></table>';
}
function togC(c){CA[c]=!CA[c];guardarLocal();renderSub();}

/* ═══ TONELAJE DISPLAY ═══ */
function updateTonDisplay(){
  var el=document.getElementById('ton-disp');if(!el)return;
  var rows='';
  H4.forEach(function(hh){
    var mn=V['s3_ton_min_h'+hh]||'',mx=V['s3_ton_max_h'+hh]||'';
    var q1=cmToM3h(mn),q2=cmToM3h(mx);
    rows+='<div style="display:flex;align-items:center;gap:10px;margin-top:6px">'+
      '<div style="width:28px;font-size:11px;color:var(--mlt)">H'+hh+'</div>'+
      '<div style="flex:1"><div class="ton-w-lbl">'+( mn?mn+' cm → <b>'+q1+' m³/h</b>':'Mín: —')+'</div></div>'+
      '<div style="flex:1"><div class="ton-w-lbl">'+( mx?mx+' cm → <b>'+q2+' m³/h</b>':'Máx: —')+'</div></div>'+
      '</div>';
  });
  el.innerHTML='<div class="ton-w-lbl">Caudal calculado por corte</div>'+rows;
}

/* ═══ SECTION 1 ═══ */
function rGran(){return '<div class="stitle">Granulometrías de Bandas</div>'+gl('Bandas 3/8"','1 vez · mín 90%')+'<div class="fgrid">'+mk('gr_1b','Banda 1B','%',sGran)+mk('gr_7','Banda 7','%',sGran)+mk('gr_13a','Banda 13A','%',sGran)+mk('gr_13b','Banda 13B','%',sGran)+'</div>';}
function rMol(){
  regGrid('mol',[mkR('mol_md1',H8),mkR('mol_md2',H8),mkR('mol_sep',H8),mkR('mol_m1',H8),mkR('mol_m2',H8),mkR('mol_m4',H8),mkR('mol_m5',H8)]);
  return '<div class="stitle">% Sólidos Descarga Molinos</div>'+gl('H1–H8','▲▼ en header para navegar')+
    '<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Molino</th><th>Un.</th>'+gHead(H8)+'</tr></thead><tbody>'+
    hr('mol_md1','MD1 Primario','%',H8,sPrim,'any',0)+hr('mol_md2','MD2 Primario','%',H8,sPrim,'any',1)+
    hr('mol_sep','Sepro','%',H8,sSec,'any',2)+hr('mol_m1','Molino 1','%',H8,sSec,'any',3)+
    hr('mol_m2','Molino 2','%',H8,sSec,'any',4)+hr('mol_m4','Molino 4','%',H8,sSec,'any',5)+hr('mol_m5','Molino 5','%',H8,sSec,'any',6)+'</tbody></table></div>';
}
function rCC(){
  var h='<div class="stitle">Carga Circulante</div>'+gl('Datos de Alimento')+'<div class="fgrid">'+mk('cc_alim_sol','% Sólidos Alimento','%',sAlim)+mk('cc_alim_m200','% M200 Alimento','%',sFree)+'</div>'+gl('Ciclones 1–7')+rCic()+
    '<div class="ccbox"><div><div class="cclbl">CC % Sólidos</div><div class="ccval" id="cc-sol">—</div></div><div class="ccdiv"></div><div><div class="cclbl">CC Malla 200</div><div class="ccval" id="cc-mal">—</div></div></div>';
  setTimeout(calcCC,60);return h;
}
function rAlim(){
  regGrid('alim',[mkR('alim_sol',H4),mkR('alim_per',H4)]);
  return '<div class="stitle">% Sólidos Alimento + Dosis Peróxido</div>'+gl('H2,H4,H6,H8')+
    '<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Parámetro</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>'+
    hr('alim_sol','% Sólidos Alimento','%',H4,sAlim,'any',0)+hr('alim_per','Dosis Peróxido','ml/min',H4,sFree,'any',1)+'</tbody></table></div>';
}
function rCG(){
  regGrid('cg',[mkR('cg_sol',H8),mkR('cg_pas',H8),mkR('cg_cn',H8),mkR('cg_ph',H8)]);
  return '<div class="stitle">Caja General</div>'+gl('H1–H8','▲▼ para navegar')+
    '<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Parámetro</th><th>Un.</th>'+gHead(H8)+'</tr></thead><tbody>'+
    hr('cg_sol','% Sólidos','%',H8,sSol,'any',0)+hr('cg_pas','Pasante M200','%',H8,sPas,'any',1)+
    hr('cg_cn','CN Libre','lb/tm',H8,sCN,'0.01',2)+hr('cg_ph','pH','',H8,sPH,'0.1',3)+'</tbody></table></div>';
}
function rPeso(){
  regGrid('peso',[mkR('pes_min',H8),mkR('pes_max',H8)]);
  var pb13a=V['pb_13a']||'',pb13=V['pb_13']||'';
  var tph13a=pbToTph(pb13a),tph13=pbToTph(pb13);
  return '<div class="stitle">Pesómetros y Bandas</div>'+gl('Pesómetro H1–H8')+
    '<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Valor</th><th>Un.</th>'+gHead(H8)+'</tr></thead><tbody>'+
    hr('pes_min','Mínimo','ton/h',H8,sFree,'any',0)+hr('pes_max','Máximo','ton/h',H8,sFree,'any',1)+'</tbody></table></div>'+
    gl('Pie de Banda','1 vez · ×6.223543276')+
    '<div class="fgrid">'+mk('pb_13a','Banda 13A','lb/ft',sFree)+mk('pb_13','Banda 13','lb/ft',sFree)+'</div>'+
    '<div style="background:var(--su2);border:1px solid var(--bdr);border-radius:8px;padding:12px;margin-bottom:12px;display:flex;gap:20px;flex-wrap:wrap">'+
    '<div><div style="font-size:11px;color:var(--mu);margin-bottom:3px">Banda 13A → T/h calculadas</div>'+
    '<div style="font-size:24px;font-weight:700;color:var(--md)" id="tph-13a">'+(tph13a||'—')+'</div></div>'+
    '<div><div style="font-size:11px;color:var(--mu);margin-bottom:3px">Banda 13 → T/h calculadas</div>'+
    '<div style="font-size:24px;font-weight:700;color:var(--md)" id="tph-13">'+(tph13||'—')+'</div></div></div>';
}
function rPhCN(){
  var h='<div class="stitle">pH Tanques de Cianuro</div>'+gl('2 veces por turno')+'<div class="phgrid">';
  for(var t=1;t<=2;t++){h+='<div class="phtank"><div class="phttl">Tanque CN #'+t+'</div>';
    for(var r2=1;r2<=2;r2++){var kh='phcn_t'+t+'r'+r2+'_h',kv='phcn_t'+t+'r'+r2+'_v';
      h+='<div class="phrow"><div class="phrl">Lectura '+r2+'</div><input type="time" class="tin" value="'+(V[kh]||'')+'" oninput="V[\''+kh+'\']=this.value"><input type="number" step="0.1" inputmode="decimal" placeholder="pH" class="phin" value="'+(V[kv]||'')+'" oninput="V[\''+kv+'\']=this.value"></div>';}
    h+='</div>';}
  return h+'</div>';
}
function rPhM(){
  regGrid('phm',[mkR('phm_e1a',H8),mkR('phm_e1b',H8),mkR('phm_mp',H8),mkR('phm_ch',H8)]);
  return '<div class="stitle">Medición pH por Equipo</div>'+gl('H1–H8','▲▼ para navegar')+
    '<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Equipo</th><th>Un.</th>'+gHead(H8)+'</tr></thead><tbody>'+
    hr('phm_e1a','Espesador 1A','',H8,sPH,'0.1',0)+hr('phm_e1b','Espesador 1B','',H8,sPH,'0.1',1)+
    hr('phm_mp','Molino Primario','',H8,sPH,'0.1',2)+hr('phm_ch','Clas. Helicoidal','',H8,sPH,'0.1',3)+'</tbody></table></div>';
}

/* ═══ SECTION 2 ═══ */
function rEsp1(){
  regGrid('esp1s',[mkR('esp1a_sol',H8),mkR('esp1b_sol',H8)]);
  regGrid('esp1t',[mkR('esp1a_trb',H4),mkR('esp1b_trb',H4)]);
  regGrid('esp1d',[mkR('esp1a_sed',H4),mkR('esp3b_sed',H4)]);
  return '<div class="stitle">Espesadores 1A y 1B</div>'+gl('% Sólidos','H1–H8')+
    '<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Espesador</th><th>Un.</th>'+gHead(H8)+'</tr></thead><tbody>'+hr('esp1a_sol','Esp. 1A','%',H8,sEsp1,'any',0)+hr('esp1b_sol','Esp. 1B','%',H8,sEsp1,'any',1)+'</tbody></table></div>'+
    gl('Turbidez','H2,H4,H6,H8')+'<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Espesador</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>'+hr('esp1a_trb','Esp. 1A','NTU',H4,sTurbIn,'any',0)+hr('esp1b_trb','Esp. 1B','NTU',H4,sTurbIn,'any',1)+'</tbody></table></div>'+
    gl('Sedimentación','H2,H4,H6,H8')+'<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Equipo</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>'+hr('esp1a_sed','Esp. 1A','cm/s',H4,sFree,'any',0)+hr('esp3b_sed','Esp. 3B','cm/s',H4,sFree,'any',1)+'</tbody></table></div>';
}
function rEsp3b(){
  regGrid('e3bs',[mkR('esp3b_sol',H8)]);regGrid('e3bp',[mkR('esp3b_pol',H4)]);
  return '<div class="stitle">Espesador 3B</div>'+gl('% Sólidos','H1–H8')+'<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Equipo</th><th>Un.</th>'+gHead(H8)+'</tr></thead><tbody>'+hr('esp3b_sol','Esp. 3B','%',H8,sEsp1,'any',0)+'</tbody></table></div>'+
    gl('Policloruro','H2,H4,H6,H8')+'<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Parámetro</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>'+hr('esp3b_pol','Policloruro','ml/min',H4,sFree,'any',0)+'</tbody></table></div>';
}
function rEsp89(){
  var blk=[1,3,5,7];regGrid('e89',[mkR('esp8_sol',H8),mkR('esp9_sol',H8),H8.map(function(h){return blk.indexOf(h)>=0?null:'hgi-ag6_sol_h'+h;})]);
  return '<div class="stitle">Espesadores 8, 9 y Agitador 6</div>'+gl('% Sólidos','Esp.8/9: H1–H8 · Ag.6: H2,H4,H6,H8')+'<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Equipo</th><th>Un.</th>'+gHead(H8)+'</tr></thead><tbody>'+hr('esp8_sol','Esp. 8','%',H8,sEsp89,'any',0)+hr('esp9_sol','Esp. 9','%',H8,sEsp89,'any',1)+hr('ag6_sol','Agitador 6','%',H8,sAg6,'any',2,blk)+'</tbody></table></div>';
}
function rAg0(){
  regGrid('ag0b',[mkR('ag0_sol',H4),mkR('ag0_m200',H4),mkR('ag0_afcn',H4),mkR('ag0_o2',H4),mkR('ag0_ph',H4)]);
  regGrid('ag0h',[mkR('ag0_cn',H4)]);
  return '<div class="stitle">Agitador 0</div>'+gl('Parámetros bihora','H2,H4,H6,H8 · ▲▼ para navegar')+
    '<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Parámetro</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>'+
    hr('ag0_sol','% Sólidos','%',H4,sAg6,'any',0)+hr('ag0_m200','Pasante M200','%',H4,sAg0M200,'any',1)+
    hr('ag0_afcn','Aforación CN','s/L',H4,sFree,'any',2)+hr('ag0_o2','Oxígeno','ppm',H4,sAg0O2,'0.1',3)+
    hr('ag0_ph','pH','',H4,sAg0pH,'0.1',4)+'</tbody></table></div>'+
    gl('CN Libre','H2,H4,H6,H8 (bihora)')+
    '<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Parámetro</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>'+
    hr('ag0_cn','CN Libre','lb/tm',H4,sAg0CN,'0.01',0)+'</tbody></table></div>'+
    '<div class="legend"><div class="li"><div class="ld" style="background:var(--gn)"></div>Verde: 2.5–5.5 lb/tm</div><div class="li"><div class="ld" style="background:var(--yn)"></div>Amarillo: 1.5–2.5 o &gt;5.5</div><div class="li"><div class="ld" style="background:var(--rd)"></div>Rojo: &lt;1.5</div></div>';
}
function rAg12(){
  regGrid('ag12',[mkR('ag1_o2',H4),mkR('ag2_o2',H4)]);
  return '<div class="stitle">Agitadores 1 y 2</div>'+gl('O2','H2,H4,H6,H8')+'<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Equipo</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>'+hr('ag1_o2','Agitador 1','ppm',H4,sAg0O2,'0.1',0)+hr('ag2_o2','Agitador 2','ppm',H4,sAg0O2,'0.1',1)+'</tbody></table></div>';
}

/* ═══ SECTION 3 ═══ */
function rS3lab(){
  regGrid('s3lab',[mkR('s3_pregE',H4),mkR('s3_pregC',H4),mkR('s3_barC',H4),mkR('s3_barE',H4),mkR('s3_esp8',H4),mkR('s3_esp9',H4)]);
  regGrid('s3ton',[mkR('s3_ton_min',H4),mkR('s3_ton_max',H4)]);
  var h='<div class="stitle">Lab Químico · Precipitación</div>'+gl('Soluciones','H2,H4,H6,H8 · g/tm')+
    '<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Muestra</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>'+
    hr('s3_pregE','Pregnant Especial','g/tm',H4,sFree,'0.001',0)+hr('s3_pregC','Pregnant Compósito','g/tm',H4,sFree,'0.001',1)+
    hr('s3_barC','Barren Compósito','g/tm',H4,sBarren,'0.001',2)+hr('s3_barE','Barren Especial','g/tm',H4,sBarren,'0.001',3)+
    hr('s3_esp8','Espesador 8','g/tm',H4,sEspLab,'0.001',4)+hr('s3_esp9','Espesador 9','g/tm',H4,sEspLab,'0.001',5)+'</tbody></table></div>'+
    gl('Tonelaje','H2,H4,H6,H8 · Ingresar en cm')+
    '<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Medición</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>'+
    hr('s3_ton_min','Tonelaje Mínimo','cm',H4,sFree,'any',0)+
    hr('s3_ton_max','Tonelaje Máximo','cm',H4,sFree,'any',1)+'</tbody></table></div>'+
    '<div class="ton-widget" id="ton-disp"><div class="ton-w-lbl">Ingresa los cm para ver el caudal por corte</div></div>';
  setTimeout(updateTonDisplay,80);return h;
}
function rS3dos(){
  regGrid('s3dos',[mkR('s3_zinc',H4),mkR('s3_cnlib',H4),mkR('s3_cndos',H4)]);
  return '<div class="stitle">Dosificación de Reactivos</div>'+gl('H2,H4,H6,H8')+'<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Reactivo</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>'+
    hr('s3_zinc','Polvo de Zinc','g/min',H4,sFree,'0.1',0)+hr('s3_cnlib','Cianuro Libre','lb/ft',H4,sFree,'0.01',1)+hr('s3_cndos','Dosis Cianuro','s/L',H4,sFree,'0.1',2)+'</tbody></table></div>';
}
function rS3pre(){
  regGrid('s3pre',[mkR('s3_mic1',H4),mkR('s3_mic2',H4),mkR('s3_tvac',H4),mkR('s3_bvac',H4),mkR('s3_bv1',H4),mkR('s3_bv2',H4),mkR('s3_bv3',H4)]);
  return '<div class="stitle">Control de Presiones</div>'+gl('H2,H4,H6,H8')+'<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Equipo</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>'+
    hr('s3_mic1','Micronics 1','',H4,sFree,'any',0)+hr('s3_mic2','Micronics 2','',H4,sFree,'any',1)+hr('s3_tvac','Torre Vacío','',H4,sFree,'any',2)+hr('s3_bvac','Bomba Vacío','',H4,sFree,'any',3)+hr('s3_bv1','Bomba Vert. 1','',H4,sFree,'any',4)+hr('s3_bv2','Bomba Vert. 2','',H4,sFree,'any',5)+hr('s3_bv3','Bomba Vert. 3','',H4,sFree,'any',6)+'</tbody></table></div>';
}
function rS3turb(){
  regGrid('s3turb',[mkR('s3_turb_in',H4),mkR('s3_turb_out',H4)]);
  return '<div class="stitle">Turbidez Filtros Clarificadores</div>'+gl('H2,H4,H6,H8')+'<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Medición</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>'+
    hr('s3_turb_in','Entrada','NTU',H4,sTurbIn,'any',0)+hr('s3_turb_out','Salida','NTU',H4,sTurbOut,'any',1)+'</tbody></table></div>';
}
function rS3o2(){
  regGrid('s3o2',[mkR('s3_o2_10',H4),mkR('s3_o2_25',H4),mkR('s3_o2_50',H4),mkR('s3_o2_niv',H4),mkR('s3_o2_vert',H4)]);
  return '<div class="stitle">O2 Cono de Precipitación</div>'+gl('ppm','H2,H4,H6,H8')+'<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Punto</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>'+
    hr('s3_o2_10','10 cm','ppm',H4,sAg0O2,'0.1',0)+hr('s3_o2_25','25 cm','ppm',H4,sAg0O2,'0.1',1)+hr('s3_o2_50','50 cm','ppm',H4,sAg0O2,'0.1',2)+hr('s3_o2_niv','Nivel %','%',H4,sFree,'any',3)+hr('s3_o2_vert','Vertedero','ppm',H4,sAg0O2,'0.1',4)+'</tbody></table></div>';
}
function rS3fluj(){
  var h0=V['fluj_h0']||'';
  var h='<div class="stitle">Flujómetro Cono de Zinc</div>'+
    gl('Lectura Inicial (turno anterior)')+'<div class="fgrid"><div class="fcard"><div class="flbl">Lectura H0 (m³)</div><div class="frow">'+
    '<input type="number" class="fi" id="fi-fluj_h0" value="'+h0+'" placeholder="---" inputmode="decimal" step="0.01" oninput="V[\'fluj_h0\']=this.value;updFlujDeltas();programarSyncNube()">'+
    '<span class="fu">m³</span></div></div></div>'+
    gl('Lecturas Bihorarias','H2,H4,H6,H8')+
    '<div class="hwrap"><table class="hgrid"><thead><tr><th class="rl">Dato</th><th>Un.</th>'+gHead(H4)+'</tr></thead><tbody>';
  // Fila de lecturas
  h+='<tr><td class="rl">Lectura</td><td class="uc">m³</td>';
  H4.forEach(function(hh){var k='fluj_h'+hh,v=V[k]||'';
    h+='<td'+(hh===curH?' class="cur"':'')+'><input type="number" step="0.01" inputmode="decimal" class="hi" id="hgi-'+k+'" value="'+v+'" oninput="V[\''+k+'\']=this.value;updFlujDeltas();programarSyncNube()"></td>';
  });
  h+='</tr></tbody></table></div>';
  // Widget de deltas calculados
  h+='<div class="ton-widget" id="fluj-deltas"><div class="ton-w-lbl">Ingresa H0 y lecturas para ver deltas</div></div>';
  setTimeout(updFlujDeltas,80);
  return h;
}
function updFlujDeltas(){
  var el=document.getElementById('fluj-deltas');if(!el)return;
  var fd=calcOzasFluj();
  var rows='';
  var prev=parseFloat(V['fluj_h0']);
  H4.forEach(function(hh){
    var lect=V['fluj_h'+hh]||'';
    var d=fd.deltas['h'+hh], oz=fd.porCorte['h'+hh], ac=fd.acum['h'+hh];
    rows+='<div style="display:flex;align-items:center;gap:10px;margin-top:6px">'+
      '<div style="width:28px;font-size:11px;color:var(--mlt)">H'+hh+'</div>'+
      '<div style="flex:1"><div class="ton-w-lbl">Δ Vol: <b>'+(d!==undefined?d+' m³':'—')+'</b></div></div>'+
      '<div style="flex:1"><div class="ton-w-lbl">Oz: <b>'+(oz!==undefined?oz:'—')+'</b></div></div>'+
      '<div style="flex:1"><div class="ton-w-lbl">Acum: <b style="color:var(--ml)">'+(ac!==undefined?ac:'—')+'</b></div></div></div>';
  });
  var totalF=calcTotalOzFluj();
  el.innerHTML='<div class="ton-w-lbl">Volumen procesado y onzas por flujómetro</div>'+rows+
    '<div style="margin-top:10px;border-top:1px solid rgba(255,255,255,0.15);padding-top:8px">'+
    '<div class="ton-w-lbl">Total Flujómetro:</div><div class="ton-w-val">'+(totalF!==null?totalF+' oz':'—')+'</div></div>';
}

var R={s1_gran:rGran,s1_mol:rMol,s1_cc:rCC,s1_alim:rAlim,s1_cg:rCG,s1_peso:rPeso,s1_phcn:rPhCN,s1_phm:rPhM,s2_esp1:rEsp1,s2_esp3b:rEsp3b,s2_esp89:rEsp89,s2_ag0:rAg0,s2_ag12:rAg12,s3_lab:rS3lab,s3_dos:rS3dos,s3_pre:rS3pre,s3_turb:rS3turb,s3_o2:rS3o2,s3_fluj:rS3fluj};

/* ═══ SECCIONES ═══ */
var SECS=[
  {title:'Trituración y Molienda',subs:[{id:'s1_gran',label:'1.1 Granulometrías'},{id:'s1_mol',label:'1.2 Sólidos Molinos'},{id:'s1_cc',label:'1.3 Carga Circulante'},{id:'s1_alim',label:'1.4 Alimento Ciclones'},{id:'s1_cg',label:'1.5 Caja General'},{id:'s1_peso',label:'1.6 Pesómetros'},{id:'s1_phcn',label:'1.7 pH Tanques CN'},{id:'s1_phm',label:'1.8 Medición pH'}]},
  {title:'Agitadores y Espesadores',subs:[{id:'s2_esp1',label:'2.1 Esp. 1A y 1B'},{id:'s2_esp3b',label:'2.2 Espesador 3B'},{id:'s2_esp89',label:'2.3 Esp. 8, 9 y Ag. 6'},{id:'s2_ag0',label:'2.4 Agitador 0'},{id:'s2_ag12',label:'2.5 Agitadores 1 y 2'}]},
  {title:'Precipitación',subs:[{id:'s3_lab',label:'3.1 Lab Químico'},{id:'s3_dos',label:'3.2 Dosificación'},{id:'s3_pre',label:'3.3 Presiones'},{id:'s3_turb',label:'3.4 Turbidez'},{id:'s3_o2',label:'3.5 O2 Cono'},{id:'s3_fluj',label:'3.6 Flujómetro'}]}
];

/* ═══ GOOGLE SHEETS SYNC ═══ */
var SHEETS_URL='https://script.google.com/macros/s/AKfycbwFnecCtbOC9fV6eCJCW8BXmney9ZMtCO4DZy_7nBLZPRcBp-D87xk5Gf_lYIpbJ_s8XQ/exec';

/* BUG FIX #3: Sync bidireccional — guardar estado completo + cargar desde nube */
function getEstadoCompleto(){
  return {
    V:V, SD:SD, CA:CA,
    userName:userName, userShift:userShift, userRole:userRole,
    fecha:hoy(), ts:Date.now()
  };
}

function aplicarEstado(data){
  if(data.V){V=data.V;window.V=V;}
  if(data.SD)SD=data.SD;
  if(data.CA)CA=data.CA;
  if(data.userName)userName=data.userName;
  if(data.userShift)userShift=data.userShift;
  if(data.userRole)userRole=data.userRole;
}

function sincronizarTurno(callback){
  var toast=document.getElementById('col-toast');
  var msg=document.getElementById('col-toast-msg');
  if(msg)msg.innerHTML='☁ Sincronizando con Google Sheets...';
  if(toast)toast.className='col-toast show';

  var estado=getEstadoCompleto();
  var payload=JSON.stringify(estado);

  fetch(SHEETS_URL,{
    method:'POST',
    mode:'no-cors',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:'data='+encodeURIComponent(payload)
  })
  .then(function(){
    _lastSyncTs=Date.now();
    actualizarSyncUI('ok','☁ Sincronizado');
    if(msg)msg.innerHTML='✅ Datos enviados a Google Sheets';
    setTimeout(function(){
      if(toast)toast.className='col-toast';
      if(callback)callback();
    },2500);
  })
  .catch(function(){
    actualizarSyncUI('err','⚠ Sin conexión');
    if(msg)msg.innerHTML='⚠ Sin conexión — datos guardados localmente';
    setTimeout(function(){
      if(toast)toast.className='col-toast';
      if(callback)callback();
    },2500);
  });
}

function cargarDesdeNube(fecha,turno,callback){
  var url=SHEETS_URL+'?action=cargar&fecha='+encodeURIComponent(fecha)+'&turno='+encodeURIComponent(turno);
  fetch(url,{redirect:'follow'})
  .then(function(r){return r.json();})
  .then(function(data){
    if(data.status==='ok'&&data.estado){
      callback(data.estado);
    } else {
      callback(null);
    }
  })
  .catch(function(){callback(null);});
}

function mostrarCargaNube(){
  var fecha=hoy();
  var toast=document.getElementById('col-toast');
  var msg=document.getElementById('col-toast-msg');
  if(msg)msg.innerHTML='☁ Buscando turno en la nube...';
  if(toast)toast.className='col-toast show';

  // Intentar cargar cada turno del día
  var turnos=['Mañana','Tarde','Noche'];
  var encontrado=false;
  var intentos=0;

  turnos.forEach(function(t){
    cargarDesdeNube(fecha,t,function(estado){
      intentos++;
      if(estado&&!encontrado){
        encontrado=true;
        aplicarEstado(estado);
        guardarLocal();
        actualizarSyncUI('ok','☁ Cargado desde nube');
        if(userShift)setShift(userShift);
        if(userRole)setRole(userRole);
        if(msg)msg.innerHTML='✅ Turno cargado: '+userName+' · '+userShift;
        setTimeout(function(){
          if(toast)toast.className='col-toast';
          goToDash();
        },1500);
      }
      if(intentos===3&&!encontrado){
        if(msg)msg.innerHTML='No se encontró turno en la nube para hoy';
        setTimeout(function(){if(toast)toast.className='col-toast';},2500);
      }
    });
  });
}

// Auto-sync debounced (cada 30s tras cambio)
function programarSyncNube(){
  guardarLocal();
  clearTimeout(_syncTimer);
  _syncTimer=setTimeout(function(){
    if(userName&&userShift&&navigator.onLine){
      sincronizarTurno(null);
    }
  },30000);
}

function actualizarSyncUI(cls,txt){
  var el=document.getElementById('sync-status');
  if(el){el.className='sync-status '+cls;el.textContent=txt;}
  // #4: persistir timestamp de última sync exitosa
  if(cls==='ok'){
    var ts=Date.now();
    _lastSyncTs=ts;
    try{localStorage.setItem('hemco_last_sync',ts);}catch(e){}
    var hora=new Date(ts).toLocaleTimeString('es-NI',{hour:'2-digit',minute:'2-digit'});
    var el2=document.getElementById('sync-ts');
    if(el2)el2.textContent='Última sync: '+hora;
  }
}

/* ═══ PERSISTENCIA LOCAL ═══ */
var LS_PREFIX='hemco_';
function turnoKey(fecha,turno){return LS_PREFIX+fecha+'_'+turno;}
function hoy(){return new Date().toISOString().slice(0,10);}

// Restaurar timestamp de sync al iniciar
(function(){try{var t=localStorage.getItem('hemco_last_sync');if(t)_lastSyncTs=+t;}catch(e){}})();

function guardarLocal(){
  if(!userName||!userShift)return;
  try{
    var key=turnoKey(hoy(),userShift);
    localStorage.setItem(key,JSON.stringify(getEstadoCompleto()));
    var idx=JSON.parse(localStorage.getItem(LS_PREFIX+'indice')||'[]');
    if(idx.indexOf(key)===-1){idx.push(key);localStorage.setItem(LS_PREFIX+'indice',JSON.stringify(idx));}
  }catch(e){}
}

function cargarTurno(key){
  try{
    var raw=localStorage.getItem(key);
    if(!raw)return false;
    var d=JSON.parse(raw);
    aplicarEstado(d);
    return true;
  }catch(e){return false;}
}

function restaurarUltimo(){
  try{
    var ah2=new Date().getHours();
    var currentShift=ah2>=7&&ah2<15?'Mañana':ah2>=15&&ah2<23?'Tarde':'Noche';
    var key=turnoKey(hoy(),currentShift);
    if(localStorage.getItem(key)){return cargarTurno(key);}
    var idx=JSON.parse(localStorage.getItem(LS_PREFIX+'indice')||'[]');
    if(idx.length>0){return cargarTurno(idx[idx.length-1]);}
    return false;
  }catch(e){return false;}
}

function listarTurnos(){
  try{
    var idx=JSON.parse(localStorage.getItem(LS_PREFIX+'indice')||'[]');
    var turnos=[];
    idx.forEach(function(key){
      try{
        var d=JSON.parse(localStorage.getItem(key));
        if(d)turnos.push({key:key,fecha:new Date(d.ts).toLocaleDateString('es-NI'),turno:d.userShift,supervisor:d.userName,ts:d.ts});
      }catch(e){}
    });
    return turnos.reverse();
  }catch(e){return [];}
}

function iniciarNuevoTurno(){
  V={};window.V=V;SD={0:{},1:{},2:{}};CA={1:true,2:true,3:true,4:true,5:true,6:false,7:false};
  userName='';userShift='';userRole='';
  var ah2=new Date().getHours();
  if(ah2>=7&&ah2<15)setShift('Mañana');else if(ah2>=15&&ah2<23)setShift('Tarde');else setShift('Noche');
  showScreen('scr-login');
}

function mostrarHistorial(){
  var turnos=listarTurnos();
  var h='<div style="padding:20px"><div style="font-size:18px;font-weight:700;color:var(--md);margin-bottom:16px">Turnos Guardados</div>';
  if(turnos.length===0){
    h+='<div style="color:var(--mu);padding:20px;text-align:center">No hay turnos guardados</div>';
  } else {
    turnos.forEach(function(t){
      h+='<div style="background:var(--sur);border:1px solid var(--bdr);border-radius:10px;padding:14px;margin-bottom:10px;cursor:pointer;-webkit-tap-highlight-color:transparent" onclick="abrirTurno(\''+t.key+'\')">'+
        '<div style="font-size:14px;font-weight:700;color:var(--md)">'+t.supervisor+' · Turno '+t.turno+'</div>'+
        '<div style="font-size:12px;color:var(--mu);margin-top:4px">'+t.fecha+' · '+new Date(t.ts).toLocaleTimeString('es-NI',{hour:'2-digit',minute:'2-digit'})+'</div></div>';
    });
  }
  h+='<button style="width:100%;padding:14px;border-radius:10px;background:var(--md);color:#fff;border:none;font-size:15px;font-weight:700;margin-top:10px;cursor:pointer;font-family:var(--f)" onclick="iniciarNuevoTurno()">+ Iniciar Nuevo Turno</button>';
  h+='<button style="width:100%;padding:12px;border-radius:10px;background:var(--su2);color:var(--mu);border:1px solid var(--bdr);font-size:13px;font-weight:700;margin-top:8px;cursor:pointer;font-family:var(--f)" onclick="goToDash()">← Volver al Dashboard</button>';
  h+='</div>';
  document.getElementById('content').innerHTML=h;
  showScreen('scr-sec');
  document.getElementById('subnav').innerHTML='';
  document.getElementById('sbar-t').textContent='Historial';
  document.getElementById('sbar-s').textContent='Turnos guardados';
  document.getElementById('sec-hn').textContent='Historial de Turnos';
  document.getElementById('sec-hs').textContent='';
  document.querySelector('#scr-sec .footer').style.display='none';
}
function abrirTurno(key){
  cargarTurno(key);
  document.querySelector('#scr-sec .footer').style.display='';
  goToDash();
}

/* ═══ CHARTS — BUG FIX #2: padding superior para datalabels ═══ */
var CLR={ok:'#16A34A',yn:'#92400E',rd:'#B91C1C',md:'#00493C',ml:'#76C810',mm:'#23CF7D'};
var zpPlugin={id:'zp',beforeDraw:function(chart){var z=chart.options.plugins&&chart.options.plugins.zones;if(!z)return;var ctx=chart.ctx,a=chart.chartArea,y=chart.scales.y;if(!a||!y)return;ctx.save();z.forEach(function(zz){var y1=y.getPixelForValue(zz.max),y2=y.getPixelForValue(zz.min);ctx.fillStyle=zz.c;ctx.fillRect(a.left,Math.min(y1,y2),a.right-a.left,Math.abs(y2-y1));});ctx.restore();}};

function getH(rid,hrs){return hrs.map(function(h){var v=parseFloat(V[rid+'_h'+h]);return isNaN(v)?null:v;});}

function mkBar(cid,labels,datasets,yMin,yMax){
  var el=document.getElementById(cid);if(!el)return;
  if(charts[cid]){charts[cid].destroy();}
  charts[cid]=new Chart(el,{type:'bar',data:{labels:labels,datasets:datasets},options:{responsive:true,maintainAspectRatio:false,
    layout:{padding:{top:28}},
    plugins:{legend:{labels:{font:{size:10},boxWidth:10,padding:6}},
      datalabels:{display:true,anchor:'end',align:'top',offset:2,font:{size:9,weight:'700'},
        formatter:function(v){return v===null?'':v;},
        color:function(ctx){return ctx.dataset.backgroundColor||'#333';}}},
    scales:{x:{grid:{color:'rgba(0,0,0,0.05)'},ticks:{font:{size:10}}},
      y:{min:yMin!=null?yMin:undefined,suggestedMax:yMax?yMax:undefined,grid:{color:'rgba(0,0,0,0.05)'},ticks:{font:{size:10}}}}},
    plugins:[ChartDataLabels]});
}

function mkDual(cid,labels,ds1,ds2,label1,label2,col1,col2){
  var el=document.getElementById(cid);if(!el)return;
  if(charts[cid]){charts[cid].destroy();}
  // BUG FIX #4: suggestedMax dinámico +20% para cada eje
  function maxOf(arr){var vals=arr.filter(function(v){return v!==null&&!isNaN(v);});return vals.length>0?Math.max.apply(null,vals):null;}
  var m1=maxOf(ds1),m2=maxOf(ds2);
  charts[cid]=new Chart(el,{type:'bar',
    data:{labels:labels,datasets:[
      {label:label1,data:ds1,backgroundColor:col1+'99',borderColor:col1,borderWidth:1,yAxisID:'y'},
      {label:label2,data:ds2,backgroundColor:col2+'99',borderColor:col2,borderWidth:1,yAxisID:'y1'}
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      layout:{padding:{top:40}},
      plugins:{legend:{labels:{font:{size:10},boxWidth:10,padding:6}},
        datalabels:{display:true,anchor:'end',align:'top',offset:2,font:{size:9,weight:'700'},
          formatter:function(v){return v===null?'':v;}}},
      scales:{
        x:{grid:{color:'rgba(0,0,0,0.05)'},ticks:{font:{size:10}}},
        y:{type:'linear',display:true,position:'left',title:{display:true,text:label1,font:{size:9}},suggestedMax:m1?m1*1.2:undefined,grid:{color:'rgba(0,0,0,0.05)'},ticks:{font:{size:9}}},
        y1:{type:'linear',display:true,position:'right',title:{display:true,text:label2,font:{size:9}},suggestedMax:m2?m2*1.2:undefined,grid:{drawOnChartArea:false},ticks:{font:{size:9}}}
      }},
    plugins:[ChartDataLabels]});
}

function gauge(pct,clr,lbl,val){var r=26,circ=2*Math.PI*r,dash=Math.min(Math.max(pct,0),100)/100*circ,gap=circ-dash,sc=clr==='ok'?CLR.ok:clr==='warn'?CLR.yn:clr==='bad'?CLR.rd:'#A8C490';return '<div class="gi"><div class="gr"><svg width="58" height="58" viewBox="0 0 58 58"><circle cx="29" cy="29" r="'+r+'" fill="none" stroke="#EBF2E4" stroke-width="7"/><circle cx="29" cy="29" r="'+r+'" fill="none" stroke="'+sc+'" stroke-width="7" stroke-dasharray="'+dash.toFixed(1)+' '+gap.toFixed(1)+'" stroke-linecap="round" transform="rotate(-90 29 29)"/></svg><div class="gr-val" style="color:'+sc+'">'+val+'</div></div><div class="g-lbl">'+lbl+'</div></div>';}
function heatRow(rid,lbl,hrs,fn){var h='<tr><td class="rl" style="padding:4px 8px;font-size:11px;background:var(--su2);font-weight:700;border-right:2px solid var(--bd2)">'+lbl+'</td>';hrs.forEach(function(hr){var v=V[rid+'_h'+hr]||'',s=fn(v);h+='<td class="'+(v?s:'mt')+'" style="font-size:11px">'+(v||'·')+'</td>';});return h+'</tr>';}

/* ═══ APP NAV ═══ */
function showScreen(id){document.querySelectorAll('.screen').forEach(function(s){s.className='screen';});document.getElementById(id).className='screen show';}
function setShift(s){userShift=s;['m','t','n'].forEach(function(x){document.getElementById('sh-'+x).className='sb';});var m={'Mañana':'m','Tarde':'t','Noche':'n'};document.getElementById('sh-'+m[s]).className='sb sel';}
function setRole(r){userRole=r;document.getElementById('rol-op').className='sb'+(r==='Operador'?' sel':'');document.getElementById('rol-su').className='sb'+(r==='Supervisor'?' sel':'');}

function startTurno(){var n=document.getElementById('inp-nombre').value.trim();if(!n){alert('Ingresa tu nombre.');return;}if(!userShift){alert('Selecciona el turno.');return;}if(!userRole){alert('Selecciona tu rol.');return;}userName=n;guardarLocal();sincronizarTurno(null);goToDash();}
function calcProgress(si){var done=0,total=SECS[si].subs.length;for(var k in SD[si]){if(SD[si][k])done++;}return{done:done,total:total,pct:total>0?Math.round(done/total*100):0};}

var TICONS=['<svg width="30" height="30" viewBox="0 0 30 30"><rect x="12" y="2" width="6" height="26" rx="3" fill="#76C810"/><rect x="2" y="12" width="26" height="6" rx="3" fill="#76C810"/></svg>','<svg width="30" height="30" viewBox="0 0 30 30"><ellipse cx="15" cy="20" rx="11" ry="5" fill="none" stroke="#76C810" stroke-width="2.5"/><ellipse cx="15" cy="14" rx="11" ry="5" fill="none" stroke="#CCF895" stroke-width="2"/><ellipse cx="15" cy="8" rx="11" ry="5" fill="none" stroke="#23CF7D" stroke-width="1.5"/></svg>','<svg width="30" height="30" viewBox="0 0 30 30"><path d="M3 27L15 5L27 27Z" fill="#76C810"/><path d="M9 27L15 12L21 27Z" fill="#00493C"/><rect x="13" y="19" width="4" height="8" rx="2" fill="#CCF895"/></svg>','<svg width="30" height="30" viewBox="0 0 30 30"><rect x="2" y="20" width="6" height="8" rx="1.5" fill="#76C810"/><rect x="12" y="14" width="6" height="14" rx="1.5" fill="#23CF7D"/><rect x="22" y="7" width="6" height="21" rx="1.5" fill="#CCF895"/><polyline points="3,18 5,10 13,14 16,5 23,9 26,3" fill="none" stroke="#76C810" stroke-width="2" stroke-linecap="round"/></svg>'];

function renderTiles(){
  var h='';
  for(var i=0;i<SECS.length;i++){var p=calcProgress(i),isDone=p.done===p.total&&p.total>0;
    h+='<div class="tile'+(isDone?' done':'')+'" onclick="goToSec('+i+')"><div class="tile-chk">✓</div><div class="tile-num">Sección '+(i+1)+'</div><div>'+TICONS[i]+'</div><div class="tile-name">'+SECS[i].title+'</div><div class="tile-pw"><div class="tile-p" style="width:'+p.pct+'%"></div></div><div class="tile-st">'+p.done+' / '+p.total+' subsecciones</div></div>';}
  h+='<div class="tile dt" onclick="goToResumen()"><div class="tile-num">Sección 4</div><div>'+TICONS[3]+'</div><div class="tile-name">Dashboard · Resumen</div><div class="tile-st">Compartir reporte</div></div>';
  h+='<div class="tile" style="border-color:var(--mm);background:#F0FFF4" onclick="mostrarHistorial()"><div class="tile-num">Historial</div><div style="font-size:28px;opacity:.6">📋</div><div class="tile-name">Turnos Anteriores</div><div class="tile-st">Ver y cambiar de turno</div></div>';
  h+='<div class="tile" style="border-color:var(--rd);background:#FFF5F5" onclick="iniciarNuevoTurno()"><div class="tile-num">Nuevo</div><div style="font-size:28px;opacity:.6">🔄</div><div class="tile-name">Iniciar Nuevo Turno</div><div class="tile-st">Cambia turno sin perder datos</div></div>';
  h+='<div class="tile" style="grid-column:span 2;border-color:#7C3AED;background:#F5F3FF" onclick="abrirConfigModal()"><div style="display:flex;align-items:center;gap:10px"><div style="font-size:22px">⚙</div><div><div style="font-size:13px;font-weight:700;color:#5B21B6">Parámetros del Semáforo</div><div style="font-size:11px;color:#7C3AED">Editar rangos verde/amarillo/rojo</div></div></div></div>';
  document.getElementById('tgrid').innerHTML=h;
}

/* ═══ MODAL CONFIGURACIÓN PARÁMETROS ═══ */
function abrirConfigModal(){
  var campos=[
    {k:'gran_ok',      lbl:'Granulometría — mínimo OK (%)',      step:'1'},
    {k:'prim_lo',      lbl:'Sólidos Primarios — mínimo verde (%)',step:'0.1'},
    {k:'prim_hi',      lbl:'Sólidos Primarios — máximo verde (%)',step:'0.1'},
    {k:'sec_lo',       lbl:'Sólidos Secundarios — mínimo verde (%)',step:'0.1'},
    {k:'sec_hi',       lbl:'Sólidos Secundarios — máximo verde (%)',step:'0.1'},
    {k:'alim_ok_lo',   lbl:'Alimento Ciclones — mínimo verde (%)',step:'0.1'},
    {k:'alim_ok_hi',   lbl:'Alimento Ciclones — máximo verde (%)',step:'0.1'},
    {k:'sol_bad',      lbl:'CG % Sólidos — límite rojo inferior',  step:'0.1'},
    {k:'sol_warn',     lbl:'CG % Sólidos — límite amarillo superior',step:'0.1'},
    {k:'sol_ok',       lbl:'CG % Sólidos — límite verde superior', step:'0.1'},
    {k:'cn_bad_lo',    lbl:'CN Libre CG — límite rojo inferior',   step:'0.01'},
    {k:'cn_warn_lo',   lbl:'CN Libre CG — inicio verde',           step:'0.01'},
    {k:'cn_ok_hi',     lbl:'CN Libre CG — fin verde',              step:'0.01'},
    {k:'cn_warn_hi',   lbl:'CN Libre CG — límite rojo superior',   step:'0.01'},
    {k:'ag0cn_bad',    lbl:'CN Libre Ag0 — límite rojo inferior',  step:'0.01'},
    {k:'ag0cn_warn',   lbl:'CN Libre Ag0 — inicio verde',          step:'0.01'},
    {k:'ag0cn_ok',     lbl:'CN Libre Ag0 — fin verde',             step:'0.01'},
    {k:'barren_ok',    lbl:'Barren Compósito — límite OK (<)',      step:'0.001'},
    {k:'esplab_ok',    lbl:'Barren Espesadores — límite OK (<)',    step:'0.001'},
    {k:'ph_ok_lo',     lbl:'pH — mínimo verde',                    step:'0.1'},
    {k:'ph_ok_hi',     lbl:'pH — máximo verde',                    step:'0.1'},
  ];
  var filas=campos.map(function(f){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--su2)">'+
      '<div style="font-size:12px;color:var(--tx2);flex:1;padding-right:10px">'+f.lbl+'</div>'+
      '<input type="number" step="'+f.step+'" value="'+CFG[f.k]+'" data-key="'+f.k+'" '+
      'style="width:80px;padding:6px 8px;border:1.5px solid var(--bdr);border-radius:6px;text-align:right;font-size:14px;font-weight:700;font-family:var(--f);color:var(--tx);background:var(--bg)">'+
      '</div>';
  }).join('');

  var m=document.getElementById('cfg-modal');
  if(!m){
    m=document.createElement('div');
    m.id='cfg-modal';
    m.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end';
    document.body.appendChild(m);
  }
  m.innerHTML='<div style="background:var(--sur);border-radius:16px 16px 0 0;width:100%;max-height:85vh;display:flex;flex-direction:column">'+
    '<div style="padding:14px 16px;background:var(--md);border-radius:16px 16px 0 0;display:flex;align-items:center;gap:10px">'+
    '<div style="font-size:14px;font-weight:700;color:#fff;flex:1">⚙ Parámetros del Semáforo</div>'+
    '<button onclick="resetCFG()" style="background:rgba(255,255,255,0.15);border:none;color:var(--mlt);padding:6px 12px;border-radius:8px;font-size:11px;cursor:pointer;font-family:var(--f)">↺ Restaurar</button>'+
    '<button onclick="cerrarConfigModal()" style="background:rgba(255,255,255,0.15);border:none;color:#fff;padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-family:var(--f)">✕</button></div>'+
    '<div style="overflow-y:auto;padding:0 16px 16px;flex:1">'+
    '<div style="font-size:11px;color:var(--mu);padding:10px 0 6px">Edita los rangos y pulsa Guardar. Los cambios se aplican de inmediato al semáforo.</div>'+
    filas+'</div>'+
    '<div style="padding:12px 16px;border-top:1px solid var(--bdr);display:flex;gap:10px">'+
    '<button onclick="cerrarConfigModal()" style="flex:1;padding:13px;border-radius:10px;background:var(--su2);color:var(--mu);border:1px solid var(--bdr);font-size:14px;font-weight:700;font-family:var(--f);cursor:pointer">Cancelar</button>'+
    '<button onclick="guardarConfigModal()" style="flex:2;padding:13px;border-radius:10px;background:#5B21B6;color:#fff;border:none;font-size:14px;font-weight:700;font-family:var(--f);cursor:pointer">✓ Guardar cambios</button>'+
    '</div></div>';
  m.style.display='flex';
}

function guardarConfigModal(){
  var m=document.getElementById('cfg-modal');
  if(!m)return;
  m.querySelectorAll('input[data-key]').forEach(function(inp){
    var k=inp.dataset.key, v=parseFloat(inp.value);
    if(!isNaN(v))CFG[k]=v;
  });
  guardarCFG();
  cerrarConfigModal();
  // Feedback visual
  var toast=document.getElementById('col-toast'),msg=document.getElementById('col-toast-msg');
  if(msg)msg.innerHTML='✓ Parámetros del semáforo actualizados';
  if(toast)toast.className='col-toast show';
  setTimeout(function(){if(toast)toast.className='col-toast';},2000);
}

function cerrarConfigModal(){
  var m=document.getElementById('cfg-modal');
  if(m)m.style.display='none';
}

function resetCFG(){
  if(!confirm('¿Restaurar todos los rangos a los valores por defecto?'))return;
  CFG=JSON.parse(JSON.stringify(CFG_DEFAULT));
  guardarCFG();
  cerrarConfigModal();
}
function goToDash(){
  cancelJump();showScreen('scr-dash');
  var ini=userName.split(' ').map(function(w){return w[0];}).join('').substring(0,2).toUpperCase();
  document.getElementById('d-av').textContent=ini;
  document.getElementById('d-un').textContent=userName;
  document.getElementById('d-ui').textContent=userRole+' · Turno '+userShift;
  document.getElementById('tbg-dash').textContent='Turno '+userShift;
  // #4: mostrar timestamp de última sync
  var tsel=document.getElementById('sync-ts');
  if(tsel&&_lastSyncTs){
    var hora=new Date(_lastSyncTs).toLocaleTimeString('es-NI',{hour:'2-digit',minute:'2-digit'});
    tsel.textContent='Última sync: '+hora;
  }
  renderTiles();
}
function goToSec(si){curSec=si;curSub=0;document.getElementById('sec-hn').textContent=SECS[si].title;document.getElementById('tbg-sec').textContent=userShift;showScreen('scr-sec');renderNav();renderSub();}
function goToResumen(){showScreen('scr-db');document.getElementById('db-hdr-info').textContent=userName+' · Turno '+userShift;Object.keys(charts).forEach(function(k){if(charts[k]){charts[k].destroy();delete charts[k];}});renderDashboard();}
function renderNav(){var subs=SECS[curSec].subs,h='';for(var i=0;i<subs.length;i++){h+='<button class="snb '+(i===curSub?'active':'')+(SD[curSec][i]?' done':'')+'" onclick="goSub('+i+')"><span class="sdot"></span>'+subs[i].label+'</button>';}document.getElementById('subnav').innerHTML=h;}
function renderSub(){var subs=SECS[curSec].subs;fGrid=null;document.getElementById('nav-arrows').style.display='none';document.getElementById('sbar-t').textContent=SECS[curSec].title;document.getElementById('sbar-s').textContent='Sec.'+(curSec+1)+' · '+subs[curSub].label;document.getElementById('sec-hs').textContent=subs[curSub].label;try{document.getElementById('content').innerHTML=R[subs[curSub].id]();}catch(e){document.getElementById('content').innerHTML='<div style="padding:20px;color:red;font-size:12px">Error: '+e.message+'</div>';}var pct=Math.round((curSub+1)/subs.length*100);document.getElementById('pf').style.width=pct+'%';document.getElementById('pl').textContent=(curSub+1)+'/'+subs.length;document.getElementById('bprev').style.visibility=curSub===0?'hidden':'visible';document.getElementById('bnext').textContent=curSub===subs.length-1?'✓ Completar':'Siguiente →';document.getElementById('content').scrollTop=0;}
function goSub(i){curSub=i;renderNav();renderSub();guardarLocal();}
function prevSub(){if(curSub>0){SD[curSec][curSub]=true;goSub(curSub-1);}}
function nextSub(){
  SD[curSec][curSub]=true;
  var s=SECS[curSec].subs;
  if(curSub<s.length-1){goSub(curSub+1);}
  else{
    var isLastSection=(curSec===SECS.length-1);
    renderTiles();
    if(isLastSection){sincronizarTurno(function(){goToDash();});}
    else{goToDash();}
  }
}
function tick(){var t=new Date().toLocaleTimeString('es-NI',{hour:'2-digit',minute:'2-digit'});['login','dash','sec','db'].forEach(function(x){var el=document.getElementById('clk-'+x);if(el)el.textContent=t;});var dht=document.getElementById('db-hdr-time');if(dht)dht.textContent=t;}

function buildHero(){
  var ozData=calcOzasAcum();
  var recData=calcRecupCortes();
  var totalOz=calcTotalOz();
  var ccVals=calcCCvals();

  var ag0M200=getLastH4('ag0_m200');
  var ag0Sol=getLastH4('ag0_sol');
  var ag0CN=getLastH4('ag0_cn');
  var pregC=getLastH4('s3_pregC');
  var barrC=getLastH4('s3_barC');

  function kpiS(v,fn){return v!==null&&v!==undefined?fn(String(v)):'mt';}
  function kpiV(v){return v!==null&&v!==undefined?String(v):'—';}
  function sCCval(v){if(v===null)return'mt';return v>=300&&v<=500?'ok':v>500?'warn':'bad';}
  var recColor=!recData.prom?'rgba(255,255,255,0.3)':+recData.prom>=95?CLR.ml:+recData.prom>=85?'#FCD34D':'#FCA5A5';

  var h='<div class="hero-sec"><div class="hero-title">◆ Parámetros Críticos del Turno</div><div class="hero-grid">';
  h+='<div class="hkpi"><div class="hkpi-icon">⊿</div><div class="hkpi-lbl">% M200 · Agitador 0</div><div class="hkpi-val '+kpiS(ag0M200,sAg0M200)+'">'+kpiV(ag0M200)+'</div><div class="hkpi-unit">%</div></div>';
  h+='<div class="hkpi"><div class="hkpi-icon">▣</div><div class="hkpi-lbl">% Sólidos · Agitador 0</div><div class="hkpi-val '+kpiS(ag0Sol,sAg6)+'">'+kpiV(ag0Sol)+'</div><div class="hkpi-unit">%</div></div>';
  h+='<div class="hkpi"><div class="hkpi-icon">◈</div><div class="hkpi-lbl">CN Libre · Agitador 0</div><div class="hkpi-val '+kpiS(ag0CN,sAg0CN)+'">'+kpiV(ag0CN)+'</div><div class="hkpi-unit">lb/tm</div></div>';
  h+='<div class="hkpi"><div class="hkpi-icon">↑</div><div class="hkpi-lbl">Pregnant Compósito</div><div class="hkpi-val '+(pregC!==null?'ok':'mt')+'">'+kpiV(pregC)+'</div><div class="hkpi-unit">g/tm</div></div>';
  h+='<div class="hkpi"><div class="hkpi-icon">↓</div><div class="hkpi-lbl">Barren Compósito (&lt;'+CFG.barren_ok+')</div><div class="hkpi-val '+kpiS(barrC,sBarren)+'">'+kpiV(barrC)+'</div><div class="hkpi-unit">g/tm</div></div>';
  h+='<div class="hkpi" style="grid-column:span 2;background:rgba(35,207,125,0.12);border-color:rgba(35,207,125,0.3)">'+
    '<div class="hkpi-lbl">⟳ Carga Circulante</div>'+
    '<div style="display:flex;gap:24px;margin-top:4px">'+
    '<div><div style="font-size:10px;color:rgba(255,255,255,0.55);margin-bottom:2px">Por % Sólidos</div>'+
    '<div class="hkpi-val '+(ccVals.sol!==null?sCCval(ccVals.sol):'mt')+'" style="font-size:26px">'+(ccVals.sol!==null?ccVals.sol:'—')+'</div><div class="hkpi-unit">%</div></div>'+
    '<div><div style="font-size:10px;color:rgba(255,255,255,0.55);margin-bottom:2px">Por Malla 200</div>'+
    '<div class="hkpi-val '+(ccVals.mal!==null?sCCval(ccVals.mal):'mt')+'" style="font-size:26px">'+(ccVals.mal!==null?ccVals.mal:'—')+'</div><div class="hkpi-unit">%</div></div>'+
    '<div style="margin-left:auto;font-size:10px;color:rgba(255,255,255,0.4);align-self:flex-end">Rango típico:<br>300–500%</div></div></div>';

  // ONZAS — FIX #3: usar porCorte (individual) y acum (progresivo) correctamente
  h+='<div class="oz-card"><div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">'+
    '<div><div class="hkpi-lbl">★ Onzas Precipitadas · Acumulado del Turno</div>'+
    '<div class="oz-big">'+(totalOz!==null?totalOz:'—')+'<span style="font-size:14px;color:rgba(255,255,255,0.5);margin-left:4px">oz totales</span></div></div></div>'+
    '<div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
    '<div><div style="font-size:10px;color:rgba(255,255,255,0.55);margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Producción por Corte (ese bihora)</div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap">';
  H4.forEach(function(hh){var v=ozData.porCorte['h'+hh];h+='<div class="oz-cut"><div class="oz-cut-h">H'+hh+'</div><div class="oz-cut-v" style="color:#FCD34D">'+(v!==undefined?v+' oz':'—')+'</div></div>';});
  h+='</div></div><div><div style="font-size:10px;color:rgba(255,255,255,0.55);margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.3px">Acumulado Progresivo</div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap">';
  H4.forEach(function(hh){var v=ozData.acum['h'+hh];h+='<div class="oz-cut"><div class="oz-cut-h">H'+hh+'</div><div class="oz-cut-v">'+(v!==undefined?v+' oz':'—')+'</div></div>';});
  h+='</div></div></div></div>';

  h+='<div class="hero-rec"><div class="hero-rec-title">% Recuperación Merrill-Crowe · Promedio del Turno</div>'+
    '<div class="hero-rec-row"><div><div class="hero-rec-num" style="color:'+recColor+'">'+(recData.prom||'—')+'</div>'+
    (recData.prom?'<div style="font-size:11px;color:rgba(255,255,255,0.6)">% promedio</div>':'')+'</div>'+
    '<div style="flex:1;min-width:80px">'+(recData.prom?'<div class="rec-bar"><div class="rec-fill" style="width:'+Math.min(+recData.prom,100)+'%;background:'+recColor+'"></div></div>':'')+
    '<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:6px;line-height:1.8">Pregnant C: <b style="color:#fff">'+(pregC||'—')+'</b> g/tm<br>Barren C: <b style="color:#fff">'+(barrC||'—')+'</b> g/tm<br>Onzas acum: <b style="color:'+CLR.ml+'">'+(totalOz||'—')+'</b> oz</div></div></div>';
  h+='<div class="rec-cuts">';
  H4.forEach(function(hh){var r=recData.cortes['h'+hh];h+='<div class="rec-cut">H'+hh+': <b>'+(r||'—')+(r?'%':'')+'</b></div>';});
  h+='</div></div></div></div>';
  return h;
}

/* ═══ DASHBOARD RENDER ═══ */
function renderDashboard(){
  var now=new Date();
  var prog=0,tot=0;
  SECS.forEach(function(s,i){s.subs.forEach(function(sub,j){tot++;if(SD[i][j])prog++;});});
  var pct=tot>0?Math.round(prog/tot*100):0;
  var st={ok:0,warn:0,bad:0};
  function ck(v,fn){var s=fn(v||'');if(s==='ok')st.ok++;else if(s==='warn')st.warn++;else if(s==='bad')st.bad++;}
  H8.forEach(function(h){ck(V['cg_sol_h'+h],sSol);ck(V['cg_cn_h'+h],sCN);});
  H4.forEach(function(h){ck(V['ag0_sol_h'+h],sAg6);ck(V['ag0_m200_h'+h],sAg0M200);ck(V['ag0_cn_h'+h],sAg0CN);ck(V['s3_barC_h'+h],sBarren);});

  var html='<div style="background:'+CLR.md+';padding:14px 16px;display:flex;justify-content:space-between;align-items:flex-start">'+
    '<div><div style="font-size:15px;font-weight:700;color:#fff">HEMCO · Reporte de Turno</div>'+
    '<div style="font-size:11px;color:#CCF895;margin-top:2px">'+userName+' · '+userRole+' · Turno '+userShift+'</div></div>'+
    '<div style="text-align:right"><div style="font-size:20px;font-weight:300;color:#76C810;font-variant-numeric:tabular-nums" id="db-hdr-time">'+now.toLocaleTimeString('es-NI',{hour:'2-digit',minute:'2-digit'})+'</div>'+
    '<div style="font-size:11px;color:#CCF895">'+now.toLocaleDateString('es-NI',{day:'2-digit',month:'short',year:'numeric'})+'</div></div></div>';
  html+='<div class="legend-bar"><div class="leg-item"><div class="leg-dot g"></div>Verde = Parámetro dentro del rango</div><div class="leg-item"><div class="leg-dot y"></div>Amarillo = Cerca del límite crítico</div><div class="leg-item"><div class="leg-dot r"></div>Rojo = Fuera del rango</div></div>';
  html+='<div style="background:#fff;border-bottom:1px solid #C8DCBA;padding:10px 14px"><div style="font-size:11px;color:#5A7E6A;margin-bottom:4px">Progreso del reporte: '+pct+'%</div><div style="height:6px;background:#EBF2E4;border-radius:3px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:#76C810;border-radius:3px"></div></div></div>'+
    '<div style="display:flex;gap:8px;padding:10px 14px;background:#fff;border-bottom:1px solid #C8DCBA">'+
    '<div style="flex:1;text-align:center;padding:7px;border-radius:8px;background:rgba(22,163,74,0.11)"><div style="font-size:20px;font-weight:700;color:#16A34A">'+st.ok+'</div><div style="font-size:10px;color:#5A7E6A">En rango</div></div>'+
    '<div style="flex:1;text-align:center;padding:7px;border-radius:8px;background:rgba(146,64,14,0.11)"><div style="font-size:20px;font-weight:700;color:#92400E">'+st.warn+'</div><div style="font-size:10px;color:#5A7E6A">Límite</div></div>'+
    '<div style="flex:1;text-align:center;padding:7px;border-radius:8px;background:rgba(185,28,28,0.11)"><div style="font-size:20px;font-weight:700;color:#B91C1C">'+st.bad+'</div><div style="font-size:10px;color:#5A7E6A">Fuera</div></div></div>';
  html+=buildHero();
  html+='<div class="db-content">';
  // SEC 1
  html+='<div class="db-sec"><div class="db-sec-hdr"><svg width="28" height="28" viewBox="0 0 28 28"><rect x="11" y="2" width="6" height="24" rx="3" fill="#76C810"/><rect x="2" y="11" width="24" height="6" rx="3" fill="#76C810"/></svg><span class="db-sec-title">Sección 1 · Trituración y Molienda</span></div><div class="db-sec-body">';
  html+='<div><div class="db-ct">Granulometrías · % Pase 3/8"</div><div class="gauge-row">';
  var gks=['gr_1b','gr_7','gr_13a','gr_13b'],gls=['B-1B','B-7','B-13A','B-13B'];
  for(var gi=0;gi<gks.length;gi++){var gv=parseFloat(V[gks[gi]])||0,gc=sGran(V[gks[gi]]||'');html+=gauge(gv,gc,gls[gi],gv?gv+'%':'—');}
  html+='</div></div>';
  html+='<div><div class="db-ct">Caja General · % Sólidos y Pasante M200</div><div class="db-cw"><canvas id="ch-cgsp"></canvas></div></div>';
  html+='<div><div class="db-ct">Caja General · CN Libre (lb/tm)</div><div class="db-cw"><canvas id="ch-cgcn"></canvas></div></div>';
  html+='<div><div class="db-ct">pH por Equipo · H1–H8</div><div class="db-cw"><canvas id="ch-ph"></canvas></div></div>';
  html+='<div><div class="db-ct">% Sólidos Alimento Ciclones · H2,H4,H6,H8</div><div class="db-cw sm"><canvas id="ch-alim"></canvas></div></div>';
  html+='<div><div class="db-ct">Sólidos Molinos · Heatmap</div><div style="overflow-x:auto"><table class="hmap"><thead><tr><th class="rl">Molino</th>'+H8.map(function(h){return'<th>H'+h+'</th>';}).join('')+'</tr></thead><tbody>'+
    heatRow('mol_md1','MD1',H8,sPrim)+heatRow('mol_md2','MD2',H8,sPrim)+heatRow('mol_sep','Sepro',H8,sSec)+
    heatRow('mol_m1','M1',H8,sSec)+heatRow('mol_m2','M2',H8,sSec)+heatRow('mol_m4','M4',H8,sSec)+heatRow('mol_m5','M5',H8,sSec)+
    '</tbody></table></div></div>';
  var ccD=calcCCvals();
  html+='<div style="background:var(--su2);border:1px solid var(--bdr);border-radius:10px;padding:12px"><div class="db-ct" style="margin-bottom:8px">Carga Circulante</div><div style="display:flex;gap:20px;flex-wrap:wrap"><div><div style="font-size:11px;color:var(--mu)">Por % Sólidos</div><div style="font-size:28px;font-weight:700;color:'+(ccD.sol!==null?CLR.md:CLR.mu)+'">'+(ccD.sol!==null?ccD.sol+'%':'—')+'</div></div><div><div style="font-size:11px;color:var(--mu)">Por Malla 200</div><div style="font-size:28px;font-weight:700;color:'+(ccD.mal!==null?CLR.md:CLR.mu)+'">'+(ccD.mal!==null?ccD.mal+'%':'—')+'</div></div></div></div>';
  var tph13a=pbToTph(V['pb_13a']),tph13=pbToTph(V['pb_13']);
  if(tph13a||tph13){html+='<div style="background:var(--su2);border:1px solid var(--bdr);border-radius:10px;padding:12px"><div class="db-ct" style="margin-bottom:8px">Pie de Banda → Toneladas/Hora</div><div style="display:flex;gap:20px;flex-wrap:wrap">'+(tph13a?'<div><div style="font-size:11px;color:var(--mu)">Banda 13A</div><div style="font-size:24px;font-weight:700;color:var(--md)">'+tph13a+' T/h</div></div>':'')+(tph13?'<div><div style="font-size:11px;color:var(--mu)">Banda 13</div><div style="font-size:24px;font-weight:700;color:var(--md)">'+tph13+' T/h</div></div>':'')+'</div></div>';}
  html+='</div></div>';
  // SEC 2
  html+='<div class="db-sec"><div class="db-sec-hdr"><svg width="28" height="28" viewBox="0 0 28 28"><ellipse cx="14" cy="18" rx="10" ry="5" fill="none" stroke="#76C810" stroke-width="2.5"/><ellipse cx="14" cy="12" rx="10" ry="5" fill="none" stroke="#CCF895" stroke-width="2"/><ellipse cx="14" cy="6" rx="10" ry="5" fill="none" stroke="#23CF7D" stroke-width="1.5"/></svg><span class="db-sec-title">Sección 2 · Agitadores y Espesadores</span></div><div class="db-sec-body">';
  html+='<div><div class="db-ct">% Sólidos Espesadores</div><div class="db-cw"><canvas id="ch-esp"></canvas></div></div>';
  var ag0Params=[{k:'ag0_sol',l:'% Sólidos',u:'%',fn:sAg6},{k:'ag0_m200',l:'% M200',u:'%',fn:sAg0M200},{k:'ag0_afcn',l:'Aforación CN',u:'s/L',fn:sFree},{k:'ag0_o2',l:'O2',u:'ppm',fn:sAg0O2},{k:'ag0_ph',l:'pH',u:'',fn:sAg0pH}];
  html+='<div class="ag0-panel"><div class="db-ct" style="color:var(--md)">Agitador 0 · Todos los Parámetros</div><div class="ag0-grid">';
  ag0Params.forEach(function(p){html+='<div class="ag0-card"><div class="ag0-title">'+p.l+(p.u?' ('+p.u+')':'')+'</div>';H4.forEach(function(hh){var v=V[p.k+'_h'+hh]||'',s=p.fn(v);html+='<div class="mini-row"><span class="mini-lbl">H'+hh+'</span><span class="mini-val '+(v?s:'mt')+'">'+(v||'—')+'</span></div>';});html+='</div>';});
  html+='</div><div style="margin-top:10px"><div class="db-ct">CN Libre bihora (lb/tm)</div><div class="db-cw sm"><canvas id="ch-ag0cn"></canvas></div></div></div>';
  html+='<div><div class="db-ct">O2 Agitadores 1 y 2 (ppm)</div><div class="db-cw sm"><canvas id="ch-ag12"></canvas></div></div>';
  // Datos faltantes #2: Sedimentación y Policloruro
  html+='<div><div class="db-ct" style="margin-bottom:6px">Sedimentación Espesadores (cm/s) · H2,H4,H6,H8</div><div style="overflow-x:auto"><table class="hmap"><thead><tr><th class="rl">Equipo</th>'+H4.map(function(h){return'<th>H'+h+'</th>';}).join('')+'</tr></thead><tbody>'+heatRow('esp1a_sed','Esp. 1A',H4,sFree)+heatRow('esp1b_sed','Esp. 1B',H4,sFree)+heatRow('esp3b_sed','Esp. 3B',H4,sFree)+'</tbody></table></div></div>';
  html+='<div><div class="db-ct" style="margin-bottom:6px">Dosificación Reactivos · H2,H4,H6,H8</div><div style="overflow-x:auto"><table class="hmap"><thead><tr><th class="rl">Reactivo</th>'+H4.map(function(h){return'<th>H'+h+'</th>';}).join('')+'</tr></thead><tbody>'+heatRow('esp3b_pol','Policloruro (ml/min)',H4,sFree)+heatRow('s3_zinc','Polvo Zinc (g/min)',H4,sFree)+heatRow('s3_cnlib','CN Libre (lb/ft)',H4,sFree)+heatRow('s3_cndos','Dosis CN (s/L)',H4,sFree)+'</tbody></table></div></div>';
  html+='</div></div>';
  // SEC 3
  var ozData=calcOzasAcum();
  var totalOz=calcTotalOz();
  var q1_h=H4.map(function(h){return cmToM3h(V['s3_ton_min_h'+h]);});var q2_h=H4.map(function(h){return cmToM3h(V['s3_ton_max_h'+h]);});
  html+='<div class="db-sec"><div class="db-sec-hdr"><svg width="28" height="28" viewBox="0 0 28 28"><path d="M3 25L14 5L25 25Z" fill="#76C810"/><path d="M9 25L14 12L19 25Z" fill="#00493C"/><rect x="12" y="17" width="4" height="8" rx="2" fill="#CCF895"/></svg><span class="db-sec-title">Sección 3 · Precipitación (Merrill-Crowe)</span></div><div class="db-sec-body">';
  html+='<div style="background:var(--md);border-radius:10px;padding:12px;margin-bottom:4px"><div style="font-size:11px;color:var(--mlt);margin-bottom:8px;font-weight:700">CAUDAL POR CORTE (m³/h)</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">';
  H4.forEach(function(hh,i){var qi=q1_h[i],qa=q2_h[i];html+='<div style="background:rgba(255,255,255,0.1);border-radius:6px;padding:8px;text-align:center"><div style="font-size:10px;color:var(--mlt)">H'+hh+'</div><div style="font-size:14px;font-weight:700;color:var(--ml)">'+(qi&&qa?((+qi+ +qa)/2).toFixed(1):'—')+'</div><div style="font-size:9px;color:rgba(255,255,255,0.5)">'+(qi||'—')+' / '+(qa||'—')+'</div></div>';});
  html+='</div></div>';
  html+='<div><div class="db-ct">Onzas Precipitadas Acumuladas por Corte (oz)</div><div class="db-cw sm"><canvas id="ch-oz"></canvas></div></div>';
  html+='<div><div class="db-ct">Ley de Soluciones por Corte (g/tm) — eje dual</div><div class="db-cw"><canvas id="ch-pregbarr"></canvas></div></div>';
  html+='<div style="font-size:10px;color:var(--mu);margin-top:-8px;padding:0 4px;margin-bottom:8px">Eje izq: Pregnant · Eje der: Barren (escalas independientes)</div>';
  html+='<div><div class="db-ct">Turbidez Filtros (NTU) — eje dual</div><div class="db-cw sm"><canvas id="ch-turb"></canvas></div></div>';
  html+='<div style="font-size:10px;color:var(--mu);margin-top:-8px;padding:0 4px;margin-bottom:8px">Eje izq: Entrada · Eje der: Salida (escalas independientes)</div>';
  html+='<div><div class="db-ct">O2 Cono Precipitación (ppm)</div><div class="db-cw sm"><canvas id="ch-o2cono"></canvas></div></div>';
  // AUDITORÍA: Flujómetro vs Vertedero
  var flujData=calcOzasFluj();
  var totalFluj=calcTotalOzFluj();
  html+='<div style="background:var(--su2);border:2px solid #7C3AED;border-radius:10px;padding:14px;margin-top:4px"><div class="db-ct" style="color:#5B21B6;margin-bottom:10px">⚖ Auditoría: Vertedero vs Flujómetro</div>';
  html+='<div style="display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap"><div style="flex:1;min-width:120px;background:var(--sur);border:1px solid var(--bdr);border-radius:8px;padding:10px;text-align:center"><div style="font-size:10px;color:var(--mu)">Total Vertedero</div><div style="font-size:24px;font-weight:700;color:var(--md)">'+(totalOz!==null?totalOz:'—')+' <span style="font-size:12px">oz</span></div></div>';
  html+='<div style="flex:1;min-width:120px;background:var(--sur);border:1px solid #7C3AED;border-radius:8px;padding:10px;text-align:center"><div style="font-size:10px;color:#7C3AED">Total Flujómetro</div><div style="font-size:24px;font-weight:700;color:#5B21B6">'+(totalFluj!==null?totalFluj:'—')+' <span style="font-size:12px">oz</span></div></div></div>';
  html+='<div style="overflow-x:auto"><table class="hmap"><thead><tr><th class="rl">Corte</th>'+H4.map(function(h){return'<th>H'+h+'</th>';}).join('')+'</tr></thead><tbody>';
  html+='<tr><td class="rl" style="padding:4px 8px;font-size:11px;background:var(--su2);font-weight:700;border-right:2px solid var(--bd2)">Δ Vol (m³)</td>';
  H4.forEach(function(hh){var d=flujData.deltas['h'+hh];html+='<td style="font-size:11px;font-weight:700;text-align:center;border:1px solid var(--bdr)">'+(d!==undefined?d:'·')+'</td>';});
  html+='</tr><tr><td class="rl" style="padding:4px 8px;font-size:11px;background:var(--su2);font-weight:700;border-right:2px solid var(--bd2)">Oz Vertedero</td>';
  H4.forEach(function(hh){var v=ozData.porCorte['h'+hh];html+='<td style="font-size:11px;font-weight:700;text-align:center;border:1px solid var(--bdr);color:var(--md)">'+(v!==undefined?v:'·')+'</td>';});
  html+='</tr><tr><td class="rl" style="padding:4px 8px;font-size:11px;background:var(--su2);font-weight:700;border-right:2px solid var(--bd2)">Oz Flujómetro</td>';
  H4.forEach(function(hh){var v=flujData.porCorte['h'+hh];html+='<td style="font-size:11px;font-weight:700;text-align:center;border:1px solid var(--bdr);color:#5B21B6">'+(v!==undefined?v:'·')+'</td>';});
  html+='</tr></tbody></table></div></div>';
  html+='</div></div><div style="height:16px"></div></div>';

  document.getElementById('db-body').innerHTML=html;
  if(typeof Chart==='undefined')return;
  Chart.register(zpPlugin);if(typeof ChartDataLabels!=='undefined')Chart.register(ChartDataLabels);
  setTimeout(function(){
    var hl=H8.map(function(h){return'H'+h;}),h4l=H4.map(function(h){return'H'+h;});
    mkBar('ch-cgsp',hl,[{label:'% Sólidos',data:getH('cg_sol',H8),backgroundColor:'rgba(0,73,60,0.7)',borderColor:CLR.md,borderWidth:1},{label:'M200 %',data:getH('cg_pas',H8),backgroundColor:'rgba(118,200,16,0.6)',borderColor:CLR.ml,borderWidth:1}],0,100);
    mkBar('ch-cgcn',hl,[{label:'CN Libre (lb/tm)',data:getH('cg_cn',H8),backgroundColor:'rgba(180,83,9,0.7)',borderColor:'#B45309',borderWidth:1}],0,null);
    mkBar('ch-ph',hl,[{label:'Esp. 1A',data:getH('phm_e1a',H8),backgroundColor:'rgba(0,73,60,0.7)',borderColor:CLR.md,borderWidth:1},{label:'Esp. 1B',data:getH('phm_e1b',H8),backgroundColor:'rgba(118,200,16,0.6)',borderColor:CLR.ml,borderWidth:1},{label:'Molino P.',data:getH('phm_mp',H8),backgroundColor:'rgba(35,207,125,0.6)',borderColor:CLR.mm,borderWidth:1},{label:'Clas.',data:getH('phm_ch',H8),backgroundColor:'rgba(180,83,9,0.5)',borderColor:'#B45309',borderWidth:1}],9,13);
    mkBar('ch-alim',h4l,[{label:'% Sól. Alimento Ciclones',data:getH('alim_sol',H4),backgroundColor:'rgba(91,33,182,0.7)',borderColor:'#5B21B6',borderWidth:1}],0,100);
    mkBar('ch-esp',hl,[{label:'Esp 1A',data:getH('esp1a_sol',H8),backgroundColor:'rgba(0,73,60,0.7)',borderColor:CLR.md,borderWidth:1},{label:'Esp 1B',data:getH('esp1b_sol',H8),backgroundColor:'rgba(118,200,16,0.6)',borderColor:CLR.ml,borderWidth:1},{label:'Esp 3B',data:getH('esp3b_sol',H8),backgroundColor:'rgba(35,207,125,0.6)',borderColor:CLR.mm,borderWidth:1},{label:'Esp 8',data:getH('esp8_sol',H8),backgroundColor:'rgba(180,83,9,0.6)',borderColor:'#B45309',borderWidth:1},{label:'Esp 9',data:getH('esp9_sol',H8),backgroundColor:'rgba(124,58,237,0.6)',borderColor:'#7C3AED',borderWidth:1}],40,65);
    mkBar('ch-ag0cn',h4l,[{label:'CN Libre Ag0 (lb/tm)',data:getH('ag0_cn',H4),backgroundColor:'rgba(180,83,9,0.7)',borderColor:'#B45309',borderWidth:1}],0,7);
    mkBar('ch-ag12',h4l,[{label:'Ag1 O2',data:getH('ag1_o2',H4),backgroundColor:'rgba(118,200,16,0.7)',borderColor:CLR.ml,borderWidth:1},{label:'Ag2 O2',data:getH('ag2_o2',H4),backgroundColor:'rgba(35,207,125,0.6)',borderColor:CLR.mm,borderWidth:1}],0,18);
    var ozAcumArr=H4.map(function(h){return ozData.acum['h'+h]||null;});
    mkBar('ch-oz',h4l,[{label:'Onzas acumuladas (oz)',data:ozAcumArr,backgroundColor:'rgba(118,200,16,0.7)',borderColor:CLR.ml,borderWidth:1}],0,null);
    mkDual('ch-pregbarr',h4l,getH('s3_pregC',H4),getH('s3_barC',H4),'Pregnant (g/tm)','Barren (g/tm)',CLR.md,CLR.rd);
    mkDual('ch-turb',h4l,getH('s3_turb_in',H4),getH('s3_turb_out',H4),'Entrada NTU','Salida NTU',CLR.md,CLR.ml);
    mkBar('ch-o2cono',h4l,[{label:'10cm',data:getH('s3_o2_10',H4),backgroundColor:'rgba(0,73,60,0.7)',borderColor:CLR.md,borderWidth:1},{label:'25cm',data:getH('s3_o2_25',H4),backgroundColor:'rgba(118,200,16,0.6)',borderColor:CLR.ml,borderWidth:1},{label:'50cm',data:getH('s3_o2_50',H4),backgroundColor:'rgba(35,207,125,0.5)',borderColor:CLR.mm,borderWidth:1},{label:'Vert.',data:getH('s3_o2_vert',H4),backgroundColor:'rgba(180,83,9,0.6)',borderColor:'#B45309',borderWidth:1}],0,15);
  },120);
}

/* ═══ EXPORT HTML ═══ */
function exportHTML(){
  var now=new Date();
  var ozData=calcOzasAcum();  // FIX #2: estructura {porCorte, acum}
  var recData=calcRecupCortes();
  var totalOz=calcTotalOz();
  var ag0M200=getLastH4('ag0_m200'),ag0Sol=getLastH4('ag0_sol'),ag0CN=getLastH4('ag0_cn');
  var pregCLast=getLastH4('s3_pregC'),barrCLast=getLastH4('s3_barC');
  var recColor=!recData.prom?'rgba(255,255,255,0.3)':+recData.prom>=95?'#76C810':+recData.prom>=85?'#FCD34D':'#FCA5A5';

  function sColor(s){return s==='ok'?'#16A34A':s==='warn'?'#92400E':s==='bad'?'#B91C1C':'#A8C490';}
  function sBg(s){return s==='ok'?'#DCFCE7':s==='warn'?'#FEF3C7':s==='bad'?'#FEE2E2':'#F4F7F0';}
  function tCell(v,fn,unit){var s=fn(v||'');var d=(v&&v!=='')?v+(unit?' '+unit:''):'—';return '<td style="padding:6px 8px;text-align:center;border:1px solid #C8DCBA;background:'+sBg(s)+';color:'+sColor(s)+';font-weight:700;font-size:12px">'+d+'</td>';}
  function hdrC(t){return '<th style="background:#00493C;color:#fff;padding:6px 8px;text-align:center;font-size:11px;border:1px solid rgba(255,255,255,0.2)">'+t+'</th>';}
  function lblC(t){return '<td style="background:#EBF2E4;color:#1E4A38;padding:7px 10px;font-weight:700;font-size:12px;border:1px solid #C8DCBA;white-space:nowrap">'+t+'</td>';}
  function mkTbl(title,rows,hrs){var h='<div style="margin-bottom:18px"><div style="font-size:12px;font-weight:700;color:#00493C;padding:7px 12px;background:#EBF2E4;border-left:4px solid #76C810;margin-bottom:8px">'+title+'</div><div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:300px"><thead><tr>'+hdrC('Parámetro')+hdrC('Un.')+hrs.map(function(h){return hdrC('H'+h);}).join('')+'</tr></thead><tbody>';rows.forEach(function(r){h+='<tr>'+lblC(r.lbl)+'<td style="background:#EBF2E4;color:#5A7E6A;padding:5px 8px;font-size:11px;border:1px solid #C8DCBA;text-align:center">'+r.unit+'</td>'+hrs.map(function(hh){return tCell(V[r.key+'_h'+hh],r.fn,r.unit);}).join('')+'</tr>';});h+='</tbody></table></div></div>';return h;}
  function mkSingleVals(title,items){var h='<div style="margin-bottom:18px"><div style="font-size:12px;font-weight:700;color:#00493C;padding:7px 12px;background:#EBF2E4;border-left:4px solid #76C810;margin-bottom:8px">'+title+'</div><div style="display:flex;flex-wrap:wrap;gap:8px">';items.forEach(function(it){var v=V[it.key]||'',s=it.fn(v);h+='<div style="background:'+sBg(s)+';border:1px solid #C8DCBA;border-radius:8px;padding:10px 14px;min-width:120px"><div style="font-size:10px;color:#5A7E6A;margin-bottom:4px">'+it.lbl+'</div><div style="font-size:18px;font-weight:700;color:'+sColor(s)+'">'+(v||'—')+'</div><div style="font-size:10px;color:#5A7E6A">'+it.unit+'</div></div>';});h+='</div></div>';return h;}

  function arr(rid,hrs){return JSON.stringify(hrs.map(function(h){var v=parseFloat(V[rid+'_h'+h]);return isNaN(v)?null:v;}));}
  // FIX #3: suggestedMax dinámico para gráficas duales en el export
  function dualMax(rid,hrs){var vals=hrs.map(function(h){return parseFloat(V[rid+'_h'+h]);}).filter(function(v){return!isNaN(v);});return vals.length>0?(Math.max.apply(null,vals)*1.2).toFixed(3):null;}
  var h4l=JSON.stringify(H4.map(function(h){return'H'+h;}));var h8l=JSON.stringify(H8.map(function(h){return'H'+h;}));
  // FIX #2: usar ozData.acum (mismo cálculo que renderDashboard)
  var ozArr=JSON.stringify(H4.map(function(h){return ozData.acum['h'+h]||null;}));
  var recArr=JSON.stringify(H4.map(function(h){return recData.cortes['h'+h]?+recData.cortes['h'+h]:null;}));
  var mPregC=dualMax('s3_pregC',H4),mBarrC=dualMax('s3_barC',H4);
  var mTurbIn=dualMax('s3_turb_in',H4),mTurbOut=dualMax('s3_turb_out',H4);

  // FIX #3: top:40, suggestedMax dinámico; d() ahora recibe mx1,mx2
  var chartScript='<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script><script src="https://cdnjs.cloudflare.com/ajax/libs/chartjs-plugin-datalabels/2.2.0/chartjs-plugin-datalabels.min.js"><\/script><script>window.addEventListener("load",function(){if(typeof ChartDataLabels!=="undefined")Chart.register(ChartDataLabels);var b=function(id,lbs,ds,yMn,yMx){var el=document.getElementById(id);if(!el)return;new Chart(el,{type:"bar",data:{labels:lbs,datasets:ds},options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:40}},plugins:{legend:{labels:{font:{size:10},boxWidth:10}},datalabels:{display:true,anchor:"end",align:"top",offset:2,font:{size:9,weight:"bold"},formatter:function(v){return v===null?"":v;},color:"#333"}},scales:{x:{ticks:{font:{size:10}}},y:{min:yMn!=null?yMn:undefined,suggestedMax:yMx?yMx:undefined,ticks:{font:{size:10}}}}},plugins:[ChartDataLabels]});};var d=function(id,lbs,d1,d2,l1,l2,c1,c2,mx1,mx2){var el=document.getElementById(id);if(!el)return;new Chart(el,{type:"bar",data:{labels:lbs,datasets:[{label:l1,data:d1,backgroundColor:c1+"99",borderColor:c1,borderWidth:1,yAxisID:"y"},{label:l2,data:d2,backgroundColor:c2+"99",borderColor:c2,borderWidth:1,yAxisID:"y1"}]},options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:40}},plugins:{legend:{labels:{font:{size:10},boxWidth:10}},datalabels:{display:true,anchor:"end",align:"top",offset:2,font:{size:9,weight:"bold"},formatter:function(v){return v===null?"":v;}}},scales:{x:{ticks:{font:{size:10}}},y:{type:"linear",position:"left",title:{display:true,text:l1,font:{size:9}},suggestedMax:mx1||undefined,ticks:{font:{size:9}}},y1:{type:"linear",position:"right",title:{display:true,text:l2,font:{size:9}},suggestedMax:mx2||undefined,grid:{drawOnChartArea:false},ticks:{font:{size:9}}}}},plugins:[ChartDataLabels]});};b("ec-cgsp",'+h8l+',[{label:"% Sólidos",data:'+arr('cg_sol',H8)+',backgroundColor:"rgba(0,73,60,0.7)",borderColor:"#00493C",borderWidth:1},{label:"M200 %",data:'+arr('cg_pas',H8)+',backgroundColor:"rgba(118,200,16,0.6)",borderColor:"#76C810",borderWidth:1}],0,100);b("ec-cgcn",'+h8l+',[{label:"CN Libre (lb/tm)",data:'+arr('cg_cn',H8)+',backgroundColor:"rgba(180,83,9,0.7)",borderColor:"#B45309",borderWidth:1}],0,null);b("ec-alim",'+h4l+',[{label:"% Sól. Alimento Ciclones",data:'+arr('alim_sol',H4)+',backgroundColor:"rgba(91,33,182,0.7)",borderColor:"#5B21B6",borderWidth:1}],0,100);b("ec-esp",'+h8l+',[{label:"Esp 1A",data:'+arr('esp1a_sol',H8)+',backgroundColor:"rgba(0,73,60,0.7)",borderColor:"#00493C",borderWidth:1},{label:"Esp 1B",data:'+arr('esp1b_sol',H8)+',backgroundColor:"rgba(118,200,16,0.6)",borderColor:"#76C810",borderWidth:1},{label:"Esp 8",data:'+arr('esp8_sol',H8)+',backgroundColor:"rgba(180,83,9,0.6)",borderColor:"#B45309",borderWidth:1},{label:"Esp 9",data:'+arr('esp9_sol',H8)+',backgroundColor:"rgba(124,58,237,0.6)",borderColor:"#7C3AED",borderWidth:1}],40,65);b("ec-ag0cn",'+h4l+',[{label:"CN Libre Ag0 (lb/tm)",data:'+arr('ag0_cn',H4)+',backgroundColor:"rgba(180,83,9,0.7)",borderColor:"#B45309",borderWidth:1}],0,null);b("ec-oz",'+h4l+',[{label:"Onzas acumuladas (oz)",data:'+ozArr+',backgroundColor:"rgba(118,200,16,0.7)",borderColor:"#76C810",borderWidth:1}],0,null);d("ec-pregbarr",'+h4l+','+arr('s3_pregC',H4)+','+arr('s3_barC',H4)+',"Pregnant (g/tm)","Barren (g/tm)","#00493C","#B91C1C",'+mPregC+','+mBarrC+');d("ec-turb",'+h4l+','+arr('s3_turb_in',H4)+','+arr('s3_turb_out',H4)+',"Entrada NTU","Salida NTU","#00493C","#76C810",'+mTurbIn+','+mTurbOut+');b("ec-recup",'+h4l+',[{label:"Recuperación %",data:'+recArr+',backgroundColor:"rgba(118,200,16,0.7)",borderColor:"#76C810",borderWidth:1}],70,100);});<\/script>';

  var body='<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Reporte HEMCO · '+now.toLocaleDateString('es-NI')+'</title>'+chartScript+'<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,-apple-system,sans-serif;background:#F4F7F0;color:#0D2B24;font-size:14px;padding:16px}@media(max-width:480px){body{padding:10px}}.sec{background:#fff;border-radius:12px;overflow:hidden;border:1px solid #C8DCBA;margin-bottom:18px}.sh{background:#00493C;color:#fff;padding:10px 16px;font-size:13px;font-weight:700}.sb2{padding:14px}.cw{position:relative;height:180px;margin-bottom:16px}</style></head><body>';
  body+='<div style="background:#00493C;border-radius:12px;padding:16px;margin-bottom:16px"><div style="font-size:16px;font-weight:700;color:#fff">HEMCO · Reporte de Turno</div><div style="font-size:12px;color:#CCF895;margin-top:4px">'+userName+' · '+userRole+' · Turno '+userShift+'</div><div style="font-size:11px;color:#A8C490;margin-top:2px">'+now.toLocaleDateString('es-NI',{weekday:'long',year:'numeric',month:'long',day:'numeric'})+' · '+now.toLocaleTimeString('es-NI',{hour:'2-digit',minute:'2-digit'})+'</div></div>';
  body+='<div style="background:#fff;border-radius:10px;border:1px solid #C8DCBA;padding:12px 16px;margin-bottom:16px;display:flex;gap:16px;flex-wrap:wrap"><div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600"><span style="width:12px;height:12px;border-radius:50%;background:#16A34A;display:inline-block"></span>Verde = Dentro del rango</div><div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600"><span style="width:12px;height:12px;border-radius:50%;background:#92400E;display:inline-block"></span>Amarillo = Cerca del límite</div><div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600"><span style="width:12px;height:12px;border-radius:50%;background:#B91C1C;display:inline-block"></span>Rojo = Fuera del rango</div></div>';

  function hKpi(lbl,v,fn,unit){var s=fn(v||'');var clr=s==='ok'?'#76C810':s==='warn'?'#FCD34D':s==='bad'?'#FCA5A5':'rgba(255,255,255,0.3)';return '<div style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:10px 8px"><div style="font-size:10px;color:rgba(255,255,255,0.65);margin-bottom:4px">'+lbl+'</div><div style="font-size:24px;font-weight:700;color:'+clr+'">'+(v||'—')+'</div><div style="font-size:10px;color:rgba(255,255,255,0.5)">'+unit+'</div></div>';}

  body+='<div style="background:#00493C;border-radius:12px;padding:16px;margin-bottom:18px"><div style="font-size:11px;font-weight:700;color:#CCF895;letter-spacing:.5px;text-transform:uppercase;margin-bottom:12px">◆ Parámetros Críticos</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px">'+hKpi('% M200 · Ag0',ag0M200!==null?String(ag0M200):'',sAg0M200,'%')+hKpi('% Sólidos · Ag0',ag0Sol!==null?String(ag0Sol):'',sAg6,'%')+hKpi('CN Libre · Ag0',ag0CN!==null?String(ag0CN):'',sAg0CN,'lb/tm')+hKpi('Pregnant Compósito',pregCLast!==null?String(pregCLast):'',sFree,'g/tm')+hKpi('Barren Compósito',barrCLast!==null?String(barrCLast):'',sBarren,'g/tm')+hKpi('Onzas Acumuladas',totalOz!==null?String(totalOz):'',sFree,'oz')+'</div>';
  // CC en export (Bug #3)
  var ccExp=calcCCvals();
  body+='<div style="background:rgba(35,207,125,0.12);border:1.5px solid rgba(35,207,125,0.35);border-radius:8px;padding:12px;margin-top:12px;display:flex;gap:24px;flex-wrap:wrap"><div style="font-size:10px;color:#CCF895;font-weight:700;width:100%;text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px">⟳ Carga Circulante</div><div><div style="font-size:10px;color:rgba(255,255,255,0.55)">Por % Sólidos</div><div style="font-size:24px;font-weight:700;color:'+(ccExp.sol!==null?'#76C810':'rgba(255,255,255,0.3)')+'">'+(ccExp.sol!==null?ccExp.sol+'%':'—')+'</div></div><div><div style="font-size:10px;color:rgba(255,255,255,0.55)">Por Malla 200</div><div style="font-size:24px;font-weight:700;color:'+(ccExp.mal!==null?'#76C810':'rgba(255,255,255,0.3)')+'">'+(ccExp.mal!==null?ccExp.mal+'%':'—')+'</div></div></div>';
  body+='<div style="background:rgba(118,200,16,0.12);border:1.5px solid #76C810;border-radius:8px;padding:12px;margin-top:12px"><div style="font-size:10px;color:#CCF895;font-weight:700;text-transform:uppercase;margin-bottom:8px">Onzas Acumuladas por Corte</div><div style="display:flex;gap:8px;flex-wrap:wrap">';
  H4.forEach(function(hh){var v=ozData.porCorte['h'+hh];body+='<div style="background:rgba(255,255,255,0.1);border-radius:6px;padding:6px 12px;text-align:center"><div style="font-size:10px;color:rgba(255,255,255,0.6)">H'+hh+'</div><div style="font-size:16px;font-weight:700;color:#76C810">'+(v!==undefined?v+'oz':'—')+'</div></div>';});
  body+='</div></div>';
  body+='<div style="background:linear-gradient(135deg,rgba(35,207,125,0.2),rgba(118,200,16,0.15));border:2px solid #76C810;border-radius:8px;padding:14px;margin-top:12px"><div style="font-size:10px;color:#CCF895;font-weight:700;text-transform:uppercase;margin-bottom:8px">% Recuperación Merrill-Crowe · Promedio del Turno</div><div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap"><div style="font-size:40px;font-weight:700;color:'+recColor+'">'+(recData.prom||'—')+'<span style="font-size:16px">%</span></div><div>'+(recData.prom?'<div style="height:8px;background:rgba(255,255,255,0.15);border-radius:4px;overflow:hidden;width:200px;margin-bottom:8px"><div style="height:100%;width:'+Math.min(+recData.prom,100)+'%;background:'+recColor+';border-radius:4px"></div></div>':'')+'<div style="font-size:12px;color:rgba(255,255,255,0.7);line-height:1.8">Pregnant C: <b style="color:#fff">'+(pregCLast||'—')+'</b> g/tm · Barren C: <b style="color:#fff">'+(barrCLast||'—')+'</b> g/tm</div><div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">';
  H4.forEach(function(hh){var r=recData.cortes['h'+hh];body+='<span style="background:rgba(255,255,255,0.1);border-radius:4px;padding:2px 8px;font-size:11px;color:rgba(255,255,255,0.7)">H'+hh+': <b>'+(r||'—')+(r?'%':'')+'</b></span>';});
  body+='</div></div></div></div></div>';

  body+='<div class="sec"><div class="sh">Sección 1 · Trituración y Molienda</div><div class="sb2">'+mkSingleVals('Granulometrías (% Pase 3/8")',[{key:'gr_1b',lbl:'Banda 1B',unit:'%',fn:sGran},{key:'gr_7',lbl:'Banda 7',unit:'%',fn:sGran},{key:'gr_13a',lbl:'Banda 13A',unit:'%',fn:sGran},{key:'gr_13b',lbl:'Banda 13B',unit:'%',fn:sGran}])+'<div style="font-size:12px;font-weight:700;color:#00493C;padding:7px 12px;background:#EBF2E4;border-left:4px solid #76C810;margin-bottom:8px">Caja General · H1–H8</div><div class="cw"><canvas id="ec-cgsp"></canvas></div><div style="font-size:12px;font-weight:700;color:#00493C;padding:7px 12px;background:#EBF2E4;border-left:4px solid #76C810;margin-bottom:8px">CN Libre · H1–H8 (lb/tm)</div><div class="cw"><canvas id="ec-cgcn"></canvas></div><div style="font-size:12px;font-weight:700;color:#00493C;padding:7px 12px;background:#EBF2E4;border-left:4px solid #76C810;margin-bottom:8px">% Sólidos Alimento Ciclones · H2,H4,H6,H8</div><div class="cw" style="height:140px"><canvas id="ec-alim"></canvas></div>'+mkTbl('Sólidos Molinos (H1–H8)',[{key:'mol_md1',lbl:'MD1 Primario',unit:'%',fn:sPrim},{key:'mol_md2',lbl:'MD2 Primario',unit:'%',fn:sPrim},{key:'mol_sep',lbl:'Sepro',unit:'%',fn:sSec},{key:'mol_m1',lbl:'Molino 1',unit:'%',fn:sSec},{key:'mol_m2',lbl:'Molino 2',unit:'%',fn:sSec},{key:'mol_m4',lbl:'Molino 4',unit:'%',fn:sSec},{key:'mol_m5',lbl:'Molino 5',unit:'%',fn:sSec}],H8)+mkTbl('Caja General (H1–H8)',[{key:'cg_sol',lbl:'% Sólidos',unit:'%',fn:sSol},{key:'cg_pas',lbl:'Pasante M200',unit:'%',fn:sPas},{key:'cg_cn',lbl:'CN Libre',unit:'lb/tm',fn:sCN},{key:'cg_ph',lbl:'pH',unit:'',fn:sPH}],H8)+'</div></div>';
  body+='<div class="sec"><div class="sh">Sección 2 · Agitadores y Espesadores</div><div class="sb2"><div style="font-size:12px;font-weight:700;color:#00493C;padding:7px 12px;background:#EBF2E4;border-left:4px solid #76C810;margin-bottom:8px">% Sólidos Espesadores</div><div class="cw"><canvas id="ec-esp"></canvas></div>'+mkTbl('Agitador 0 · Parámetros Bihora (H2,H4,H6,H8)',[{key:'ag0_sol',lbl:'% Sólidos',unit:'%',fn:sAg6},{key:'ag0_m200',lbl:'% M200',unit:'%',fn:sAg0M200},{key:'ag0_afcn',lbl:'Aforación CN',unit:'s/L',fn:sFree},{key:'ag0_o2',lbl:'O2',unit:'ppm',fn:sAg0O2},{key:'ag0_ph',lbl:'pH',unit:'',fn:sAg0pH}],H4)+'<div style="font-size:12px;font-weight:700;color:#00493C;padding:7px 12px;background:#EBF2E4;border-left:4px solid #76C810;margin-bottom:8px">CN Libre Agitador 0 · H2,H4,H6,H8 (lb/tm)</div><div class="cw" style="height:130px"><canvas id="ec-ag0cn"></canvas></div>'+mkTbl('O2 Agitadores 1 y 2 (H2,H4,H6,H8)',[{key:'ag1_o2',lbl:'Agitador 1',unit:'ppm',fn:sAg0O2},{key:'ag2_o2',lbl:'Agitador 2',unit:'ppm',fn:sAg0O2}],H4)+mkTbl('Sedimentación Espesadores (H2,H4,H6,H8)',[{key:'esp1a_sed',lbl:'Esp. 1A',unit:'cm/s',fn:sFree},{key:'esp1b_sed',lbl:'Esp. 1B',unit:'cm/s',fn:sFree},{key:'esp3b_sed',lbl:'Esp. 3B',unit:'cm/s',fn:sFree}],H4)+mkTbl('Dosificación Reactivos (H2,H4,H6,H8)',[{key:'esp3b_pol',lbl:'Policloruro',unit:'ml/min',fn:sFree},{key:'s3_zinc',lbl:'Polvo de Zinc',unit:'g/min',fn:sFree},{key:'s3_cnlib',lbl:'CN Libre',unit:'lb/ft',fn:sFree},{key:'s3_cndos',lbl:'Dosis Cianuro',unit:'s/L',fn:sFree}],H4)+'</div></div>';
  body+='<div class="sec"><div class="sh">Sección 3 · Precipitación (Merrill-Crowe)</div><div class="sb2"><div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">';
  H4.forEach(function(hh){var mn=V['s3_ton_min_h'+hh]||'',mx=V['s3_ton_max_h'+hh]||'';var q1=cmToM3h(mn),q2=cmToM3h(mx);body+='<div style="background:#00493C;border-radius:8px;padding:10px 14px;min-width:100px"><div style="font-size:11px;color:#CCF895">H'+hh+'</div><div style="font-size:14px;font-weight:700;color:#76C810">'+(q1&&q2?((+q1+ +q2)/2).toFixed(1):'—')+'</div><div style="font-size:10px;color:#A8C490">m³/h prom</div></div>';});
  body+='</div><div style="font-size:12px;font-weight:700;color:#00493C;padding:7px 12px;background:#EBF2E4;border-left:4px solid #76C810;margin-bottom:8px">Onzas Precipitadas Acumuladas (oz)</div><div class="cw" style="height:140px"><canvas id="ec-oz"></canvas></div>';
  body+='<div style="font-size:12px;font-weight:700;color:#00493C;padding:7px 12px;background:#EBF2E4;border-left:4px solid #76C810;margin-bottom:4px">Ley Soluciones por Corte (g/tm) — Eje dual</div><div style="font-size:10px;color:#5A7E6A;padding:0 12px;margin-bottom:8px">Eje izq: Pregnant · Eje der: Barren (escalas independientes)</div><div class="cw"><canvas id="ec-pregbarr"></canvas></div>';
  body+='<div style="font-size:12px;font-weight:700;color:#00493C;padding:7px 12px;background:#EBF2E4;border-left:4px solid #76C810;margin-bottom:8px">Recuperación M-C por Corte (%)</div><div class="cw" style="height:140px"><canvas id="ec-recup"></canvas></div>';
  body+=mkTbl('Lab Químico (H2,H4,H6,H8)',[{key:'s3_pregE',lbl:'Pregnant Especial',unit:'g/tm',fn:sFree},{key:'s3_pregC',lbl:'Pregnant Compósito',unit:'g/tm',fn:sFree},{key:'s3_barC',lbl:'Barren Compósito',unit:'g/tm',fn:sBarren},{key:'s3_barE',lbl:'Barren Especial',unit:'g/tm',fn:sBarren},{key:'s3_esp8',lbl:'Espesador 8',unit:'g/tm',fn:sEspLab},{key:'s3_esp9',lbl:'Espesador 9',unit:'g/tm',fn:sEspLab}],H4);
  body+='<div style="font-size:12px;font-weight:700;color:#00493C;padding:7px 12px;background:#EBF2E4;border-left:4px solid #76C810;margin-bottom:4px">Turbidez Filtros (NTU) — Eje dual</div><div style="font-size:10px;color:#5A7E6A;padding:0 12px;margin-bottom:8px">Eje izq: Entrada · Eje der: Salida (escalas independientes)</div><div class="cw" style="height:130px"><canvas id="ec-turb"></canvas></div>';
  body+=mkTbl('Dosificación Reactivos (H2,H4,H6,H8)',[{key:'s3_zinc',lbl:'Polvo de Zinc',unit:'g/min',fn:sFree},{key:'s3_cnlib',lbl:'Cianuro Libre',unit:'lb/ft',fn:sFree},{key:'s3_cndos',lbl:'Dosis Cianuro',unit:'s/L',fn:sFree}],H4);
  body+=mkTbl('Control de Presiones (H2,H4,H6,H8)',[{key:'s3_mic1',lbl:'Micronics 1',unit:'',fn:sFree},{key:'s3_mic2',lbl:'Micronics 2',unit:'',fn:sFree},{key:'s3_tvac',lbl:'Torre Vacío',unit:'',fn:sFree},{key:'s3_bvac',lbl:'Bomba Vacío',unit:'',fn:sFree},{key:'s3_bv1',lbl:'Bomba Vert. 1',unit:'',fn:sFree},{key:'s3_bv2',lbl:'Bomba Vert. 2',unit:'',fn:sFree},{key:'s3_bv3',lbl:'Bomba Vert. 3',unit:'',fn:sFree}],H4);
  // Flujómetro en export
  var flujExp=calcOzasFluj(),totalFlujExp=calcTotalOzFluj();
  body+='<div style="margin-bottom:18px;border:2px solid #7C3AED;border-radius:10px;padding:14px;background:#F5F3FF"><div style="font-size:12px;font-weight:700;color:#5B21B6;padding:7px 12px;background:#EDE9FE;border-left:4px solid #7C3AED;margin-bottom:10px;border-radius:0 6px 6px 0">⚖ Auditoría: Vertedero vs Flujómetro</div>';
  body+='<div style="display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap"><div style="flex:1;min-width:120px;background:#fff;border:1px solid #C8DCBA;border-radius:8px;padding:10px;text-align:center"><div style="font-size:10px;color:#5A7E6A">Total Vertedero</div><div style="font-size:22px;font-weight:700;color:#00493C">'+(totalOz||'—')+' oz</div></div><div style="flex:1;min-width:120px;background:#fff;border:1px solid #7C3AED;border-radius:8px;padding:10px;text-align:center"><div style="font-size:10px;color:#7C3AED">Total Flujómetro</div><div style="font-size:22px;font-weight:700;color:#5B21B6">'+(totalFlujExp||'—')+' oz</div></div></div>';
  body+='<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr><th style="background:#5B21B6;color:#fff;padding:6px 8px;text-align:left;font-size:11px;border:1px solid rgba(255,255,255,0.2)">Corte</th>'+H4.map(function(h){return'<th style="background:#5B21B6;color:#fff;padding:6px 8px;text-align:center;font-size:11px;border:1px solid rgba(255,255,255,0.2)">H'+h+'</th>';}).join('')+'</tr></thead><tbody>';
  body+='<tr><td style="background:#EDE9FE;color:#1E4A38;padding:6px 8px;font-weight:700;font-size:12px;border:1px solid #C8DCBA">Δ Vol (m³)</td>'+H4.map(function(h){var d=flujExp.deltas['h'+h];return'<td style="padding:6px;text-align:center;border:1px solid #C8DCBA;font-weight:700;font-size:12px">'+(d!==undefined?d:'—')+'</td>';}).join('')+'</tr>';
  body+='<tr><td style="background:#EDE9FE;color:#1E4A38;padding:6px 8px;font-weight:700;font-size:12px;border:1px solid #C8DCBA">Oz Vertedero</td>'+H4.map(function(h){var v=ozData.porCorte['h'+h];return'<td style="padding:6px;text-align:center;border:1px solid #C8DCBA;font-weight:700;font-size:12px;color:#00493C">'+(v!==undefined?v:'—')+'</td>';}).join('')+'</tr>';
  body+='<tr><td style="background:#EDE9FE;color:#1E4A38;padding:6px 8px;font-weight:700;font-size:12px;border:1px solid #C8DCBA">Oz Flujómetro</td>'+H4.map(function(h){var v=flujExp.porCorte['h'+h];return'<td style="padding:6px;text-align:center;border:1px solid #C8DCBA;font-weight:700;font-size:12px;color:#5B21B6">'+(v!==undefined?v:'—')+'</td>';}).join('')+'</tr>';
  body+='</tbody></table></div></div>';
  body+='</div></div>';
  body+='<div style="text-align:center;font-size:11px;color:#5A7E6A;padding:16px 0">HEMCO Nicaragua S.A. · Reporte generado el '+now.toLocaleString('es-NI')+'</div></body></html>';

  try{
    var blob=new Blob([body],{type:'text/html;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url;a.download='HEMCO_Reporte_'+now.toISOString().slice(0,10)+'_'+userShift.replace('ñ','n')+'.html';
    a.style.display='none';document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(function(){URL.revokeObjectURL(url);},5000);
  }catch(e){
    var w=window.open('','_blank');
    if(w){w.document.write(body);w.document.close();}
    else{alert('Activa las ventanas emergentes para compartir el reporte.');}
  }
}
window.exportHTML=exportHTML;

/* ═══ EXPOSE TO WINDOW ═══ */
window.setShift=setShift;window.setRole=setRole;window.startTurno=startTurno;
window.goToDash=goToDash;window.goToSec=goToSec;window.goToResumen=goToResumen;
window.goSub=goSub;window.prevSub=prevSub;window.nextSub=nextSub;
window.navUp=navUp;window.navDown=navDown;
window.cancelJump=cancelJump;window.doJump=doJump;
window.sv=sv;window.onCI=onCI;window.onGF=onGF;
window.togC=togC;window.calcCC=calcCC;
window.sincronizarTurno=sincronizarTurno;
window.mostrarHistorial=mostrarHistorial;
window.iniciarNuevoTurno=iniciarNuevoTurno;
window.abrirTurno=abrirTurno;
window.mostrarCargaNube=mostrarCargaNube;
window.abrirConfigModal=abrirConfigModal;
window.guardarConfigModal=guardarConfigModal;
window.cerrarConfigModal=cerrarConfigModal;
window.resetCFG=resetCFG;
window.updFlujDeltas=updFlujDeltas;
// exportHTML se expone desde dashboard.js

/* ═══ INIT ═══ */
tick();setInterval(tick,1000);
var ah=new Date().getHours();
if(ah>=7&&ah<15)setShift('Mañana');else if(ah>=15&&ah<23)setShift('Tarde');else setShift('Noche');

// Mostrar botón de carga nube si hay conexión
if(navigator.onLine){
  var btn=document.getElementById('btn-cloud-load');
  if(btn)btn.style.display='';
}

// Restaurar estado
(function(){
  var ok=restaurarUltimo();
  if(ok&&userName){
    if(userShift)setShift(userShift);
    if(userRole)setRole(userRole);
    goToDash();
    // Intentar sync desde nube para obtener datos más recientes
    if(navigator.onLine){
      cargarDesdeNube(hoy(),userShift,function(estado){
        if(estado&&estado.ts&&estado.ts>(_lastSyncTs||0)){
          aplicarEstado(estado);
          guardarLocal();
          actualizarSyncUI('ok','☁ Actualizado desde nube');
        }
      });
    }
  }
})();