'use strict'
// Deterministically trains the bundled *reference* DNN on physically-informed synthetic samples.
// It is a software/integration model, not a meteorologically validated operational model.
const fs=require('node:fs'),path=require('node:path')
const {FEATURE_NAMES}=require('../lib/multimodal-features')
let seed=0x51a7c0de
function rnd(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return((seed>>>0)/4294967296)}
function normal(){const u=Math.max(1e-9,rnd()),v=rnd();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
const clamp=x=>Math.max(0,Math.min(1,x))
function sample(){
  const x=Array.from({length:FEATURE_NAMES.length},()=>0)
  // modality masks: most samples have radar/vessel; corroborating modalities can be absent.
  const masks=[1,rnd()>.25?1:0,rnd()>.2?1:0,rnd()>.2?1:0,1]
  // latent convective threat and approach, then noisy multimodal measurements.
  const conv=clamp(rnd()*.85+rnd()*.25), approach=clamp(rnd()), electrical=clamp(conv*.75+rnd()*.35), env=clamp(conv*.6+rnd()*.45)
  const put=(i,v)=>x[i]=clamp(v+normal()*.06)
  put(0,conv); put(1,approach*.8+conv*.2); put(2,approach*.55); put(3,.35+approach*.45); put(4,approach); x[5]=approach>.68&&conv>.45?1:0; put(6,.35+approach*.5); put(7,approach*.9)
  if(masks[1]){put(8,electrical);put(9,electrical*.9);x[10]=electrical>.72&&rnd()>.35?1:0;put(11,electrical*.4+approach*.5);x[12]=electrical>.55?1:0;put(13,electrical)}
  if(masks[2]){put(14,env);put(15,env*.75);put(16,env*.55);put(17,env*.7);put(18,env*.65)}
  if(masks[3]){put(19,env*.85);put(20,env*.45);put(21,env*.55);put(22,env*.65);put(23,env*.65)}
  put(24,approach); put(25,approach*.85); put(26,approach)
  for(let i=0;i<5;i++)x[27+i]=masks[i]
  // Hidden target: radar/geometry primary, lightning/environment only corroborate.
  let score=.30*x[0]+.24*x[4]+.13*x[1]+.13*x[25]+.08*x[24]
  if(masks[1]) score+=.07*x[8]+.05*x[10]
  if(masks[2]) score+=.03*x[14]
  if(masks[3]) score+=.04*x[19]
  score+=normal()*.035
  const y=score>=.68?2:score>=.43?1:0
  return{x,y}
}
const train=Array.from({length:12000},sample), test=Array.from({length:3000},sample)
const dims=[FEATURE_NAMES.length,20,10,3]
function matrix(rows,cols,scale=.12){return Array.from({length:rows},()=>Array.from({length:cols},()=>(rnd()*2-1)*scale))}
const layers=[{weights:matrix(dims[1],dims[0]),bias:Array(dims[1]).fill(0)},{weights:matrix(dims[2],dims[1]),bias:Array(dims[2]).fill(0)},{weights:matrix(dims[3],dims[2]),bias:Array(dims[3]).fill(0)}]
const relu=x=>x>0?x:0
function forward(x){let activ=[x],pre=[];for(let li=0;li<layers.length;li++){const l=layers[li],z=l.bias.map((b,j)=>b+l.weights[j].reduce((s,w,i)=>s+w*activ[li][i],0));pre.push(z);activ.push(li===layers.length-1?z:z.map(relu))}const q=activ.at(-1),m=Math.max(...q),e=q.map(v=>Math.exp(v-m)),sum=e.reduce((a,b)=>a+b,0);return{activ,pre,p:e.map(v=>v/sum)}}
const lr=.035,batch=64,epochs=22
for(let ep=0;ep<epochs;ep++){
  // deterministic Fisher-Yates
  for(let i=train.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[train[i],train[j]]=[train[j],train[i]]}
  for(let start=0;start<train.length;start+=batch){
    const bs=train.slice(start,start+batch),grads=layers.map(l=>({w:l.weights.map(r=>r.map(()=>0)),b:l.bias.map(()=>0)}))
    for(const row of bs){const f=forward(row.x);let delta=f.p.slice();delta[row.y]-=1
      for(let li=layers.length-1;li>=0;li--){const inp=f.activ[li],g=grads[li];for(let j=0;j<delta.length;j++){g.b[j]+=delta[j];for(let i=0;i<inp.length;i++)g.w[j][i]+=delta[j]*inp[i]}
        if(li>0){const prev=Array(inp.length).fill(0);for(let i=0;i<inp.length;i++){let s=0;for(let j=0;j<delta.length;j++)s+=layers[li].weights[j][i]*delta[j];prev[i]=f.pre[li-1][i]>0?s:0}delta=prev}
      }
    }
    const k=lr/bs.length;for(let li=0;li<layers.length;li++){for(let j=0;j<layers[li].bias.length;j++){layers[li].bias[j]-=k*grads[li].b[j];for(let i=0;i<layers[li].weights[j].length;i++)layers[li].weights[j][i]-=k*grads[li].w[j][i]}}
  }
}
function evalSet(rows){let ok=0,cm=Array.from({length:3},()=>Array(3).fill(0));for(const r of rows){const p=forward(r.x).p,b=p.indexOf(Math.max(...p));if(b===r.y)ok++;cm[r.y][b]++}return{accuracy:ok/rows.length,confusionMatrix:cm,count:rows.length}}
const validation=evalSet(test)
const model={format:'storm-intelligence-dnn/1',id:'stormfusion-reference-synthetic-v1',version:'1.0.0',labels:['normal','warn','alarm'],featureNames:FEATURE_NAMES,layers,training:{kind:'synthetic-physically-informed',seed:'0x51a7c0de',samples:train.length,epochs,batchSize:batch,learningRate:lr,script:'scripts/train-reference-dnn.js',warning:'Reference integration model only. Retrain and validate on frozen historical evidence before operational use.'},validation:{...validation,dataset:'held-out synthetic generator; not real-world meteorological validation'}}
const out=path.join(__dirname,'..','models','stormfusion-reference-v1.json');fs.writeFileSync(out,JSON.stringify(model,null,2)+'\n');console.log(JSON.stringify({out,validation},null,2))
