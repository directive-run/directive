// Generates the zero-flash inline script for <head>
// This runs synchronously before first paint to prevent FOUC when a user
// has a stored brand preset or is a first-time visitor getting a random one.

import {
  getAllColors,
  getAllTypos,
  ROTATION_POOL_IDS,
} from './brand-presets'
import { STORAGE_KEYS } from './storage-keys'

export function buildPresetInlineScript(): string {
  // Build compact color lookup: { presetId: { p: { shade: hex }, a: { shade: hex }, g: [from, via, to] } }
  const colorLookup: Record<string, { p: Record<string, string>; a: Record<string, string>; g: [string, string, string] }> = {}
  for (const preset of getAllColors()) {
    colorLookup[preset.id] = {
      p: preset.primary.scale,
      a: preset.accent.scale,
      g: [preset.gradient.from, preset.gradient.via, preset.gradient.to],
    }
  }

  // Build compact typo lookup: { presetId: { d: cssVar|family, b: cssVar|family, c: cssVar|family } }
  const typoLookup: Record<number, { d: string; b: string; c: string }> = {}
  for (const preset of getAllTypos()) {
    typoLookup[preset.id] = {
      d: preset.display.cssVar ? `var(${preset.display.cssVar})` : preset.display.family,
      b: preset.body.cssVar ? `var(${preset.body.cssVar})` : preset.body.family,
      c: preset.code.cssVar ? `var(${preset.code.cssVar})` : preset.code.family,
    }
  }

  const rotationPool = JSON.stringify(ROTATION_POOL_IDS)
  const typoIds = JSON.stringify(getAllTypos().map(t => t.id))

  // The inline script -- must be self-contained, no imports
  return `(function(){try{
var CK='${STORAGE_KEYS.COLOR}',TK='${STORAGE_KEYS.TYPO}',FK='${STORAGE_KEYS.FIRST_VISIT}',FSK='${STORAGE_KEYS.FONT_SIZE}';
var C=${JSON.stringify(colorLookup)};
var T=${JSON.stringify(typoLookup)};
var R=${rotationPool};
var TI=${typoIds};
var S=['50','100','200','300','400','500','600','700','800','900','950'];
var sc=localStorage.getItem(CK);
var st=localStorage.getItem(TK);
var isFirst=!sc&&!st;
if(isFirst){
  sc=R[Math.floor(Math.random()*R.length)];
  st=String(TI[Math.floor(Math.random()*TI.length)]);
  localStorage.setItem(CK,sc);
  localStorage.setItem(TK,st);
  localStorage.setItem(FK,'1');
}
if(sc&&C[sc]){
  var d=C[sc],r=document.documentElement.style;
  for(var i=0;i<S.length;i++){
    r.setProperty('--brand-primary-'+S[i],d.p[S[i]]);
    r.setProperty('--brand-accent-'+S[i],d.a[S[i]]);
  }
  r.setProperty('--brand-primary',d.p['500']);
  r.setProperty('--brand-accent',d.a['500']);
  r.setProperty('--brand-gradient-from',d.g[0]);
  r.setProperty('--brand-gradient-via',d.g[1]);
  r.setProperty('--brand-gradient-to',d.g[2]);
}
if(st&&T[Number(st)]){
  var t=T[Number(st)],r=document.documentElement.style;
  r.setProperty('--brand-font-display',t.d);
  r.setProperty('--brand-font-body',t.b);
  r.setProperty('--brand-font-code',t.c);
}
var fs=localStorage.getItem(FSK);
if(fs){var fv=parseFloat(fs);if(!isNaN(fv))document.documentElement.style.fontSize=fv+'%';}
}catch(e){}})();`
}
