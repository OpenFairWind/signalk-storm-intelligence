'use strict'

const fs = require('node:fs')
const crypto = require('node:crypto')

const relu = x => x > 0 ? x : 0
function dense(input, layer, activation = true) {
  if (!Array.isArray(layer?.weights) || !Array.isArray(layer?.bias)) throw new Error('Invalid DNN layer')
  const out = new Float32Array(layer.bias.length)
  for (let j = 0; j < out.length; j++) {
    let s = Number(layer.bias[j]) || 0
    const row = layer.weights[j]
    if (!Array.isArray(row) || row.length !== input.length) throw new Error(`DNN layer width mismatch at output ${j}`)
    for (let i = 0; i < input.length; i++) s += input[i] * row[i]
    out[j] = activation ? relu(s) : s
  }
  return out
}
function softmax(logits) {
  const m = Math.max(...logits), ex = Array.from(logits, v => Math.exp(v - m)), z = ex.reduce((a,b)=>a+b,0) || 1
  return ex.map(v => v / z)
}
function loadJsonModel(modelPath) {
  const raw = fs.readFileSync(modelPath)
  const model = JSON.parse(raw.toString('utf8'))
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex')
  if (model.format !== 'storm-intelligence-dnn/1') throw new Error(`Unsupported DNN model format: ${model.format}`)
  if (!Array.isArray(model.featureNames) || !Array.isArray(model.layers) || model.layers.length < 2) throw new Error('Incomplete DNN model')
  return { model, sha256, path:modelPath }
}
class PretrainedDnn {
  constructor(bundle) { this.bundle=bundle; this.model=bundle.model }
  predict(values) {
    if (!values || values.length !== this.model.featureNames.length) throw new Error(`Expected ${this.model.featureNames.length} DNN inputs`)
    let h = values
    for (let i=0;i<this.model.layers.length;i++) h=dense(h,this.model.layers[i],i<this.model.layers.length-1)
    const probabilities=softmax(h)
    const labels=this.model.labels || ['normal','warn','alarm']
    let best=0;for(let i=1;i<probabilities.length;i++)if(probabilities[i]>probabilities[best])best=i
    return { state:labels[best] || 'normal', confidence:probabilities[best], probabilities:Object.fromEntries(labels.map((l,i)=>[l,probabilities[i]||0])), logits:Array.from(h) }
  }
  describe(){return{id:this.model.id,version:this.model.version,format:this.model.format,sha256:this.bundle.sha256,training:this.model.training||null,validation:this.model.validation||null,featureCount:this.model.featureNames.length,labels:this.model.labels}}
}
module.exports={PretrainedDnn,loadJsonModel,dense,softmax}
