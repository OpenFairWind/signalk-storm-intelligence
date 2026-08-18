'use strict'

const path = require('node:path')
const { FEATURE_NAMES, extractMultimodalFeatures } = require('../lib/multimodal-features')
const { PretrainedDnn, loadJsonModel } = require('../lib/pretrained-dnn')

const DEFAULT_MODEL = path.join(__dirname, '..', 'models', 'stormfusion-reference-v1.json')

module.exports = {
  id: 'multimodal-dnn',
  name: 'Multimodal pretrained DNN',
  description: 'Experimental pretrained DNN threat classifier over radar geometry, lightning, Signal K Weather API, onboard environment and vessel-relative features.',
  defaults: { enabled:false, weight:0.65 },
  settingsSchema: { properties: {
    modelPath: { title:'Pretrained DNN JSON model path', type:'string', default:'' },
    weight: { title:'Ensemble weight', type:'number', minimum:0, maximum:5, default:0.65 },
    minimumConfidence: { title:'Minimum model confidence to contribute', type:'number', minimum:0, maximum:1, default:0.50 },
    completenessPenalty: { title:'Confidence penalty for missing modalities', type:'number', minimum:0, maximum:1, default:0.25 },
    requireRadarCandidate: { title:'Require an existing radar/hazard candidate', type:'boolean', default:true }
  }},
  create({ settings = {} }) {
    const modelPath = settings.modelPath ? path.resolve(String(settings.modelPath)) : DEFAULT_MODEL
    const bundle = loadJsonModel(modelPath)
    if (bundle.model.featureNames.length !== FEATURE_NAMES.length || bundle.model.featureNames.some((x,i)=>x!==FEATURE_NAMES[i])) throw new Error('DNN feature schema does not match this Storm Intelligence runtime')
    const dnn = new PretrainedDnn(bundle)
    const minimumConfidence = Number.isFinite(Number(settings.minimumConfidence)) ? Math.max(0,Math.min(1,Number(settings.minimumConfidence))) : 0.50
    const completenessPenalty = Number.isFinite(Number(settings.completenessPenalty)) ? Math.max(0,Math.min(1,Number(settings.completenessPenalty))) : 0.25
    const requireRadarCandidate = settings.requireRadarCandidate !== false
    return {
      id:'multimodal-dnn', name:'Multimodal pretrained DNN', version:'1', weight:Number(settings.weight)||0.65,
      description: module.exports.description,
      capabilities:{multimodal:true,pretrainedDnn:true,radar:true,lightning:true,onboardEnvironment:true,weatherApi:true,vesselRelative:true,candidateRefiner:true,detector:false},
      model:dnn.describe(),
      infer(context) {
        const candidates = context.baseCells || []
        if (!candidates.length) return []
        return candidates.map(cell => {
          if (requireRadarCandidate && !cell.geometry && cell.severity == null) return cell
          const features = extractMultimodalFeatures(cell, context)
          const prediction = dnn.predict(features.values)
          const adjustedConfidence = Math.max(0, Math.min(1, prediction.confidence * (1 - completenessPenalty * (1 - features.modalityCompleteness))))
          if (adjustedConfidence < minimumConfidence) return { ...cell, ml:{model:dnn.describe(),prediction:{...prediction,adjustedConfidence,accepted:false},features:{modalityCompleteness:features.modalityCompleteness,masks:features.masks}} }
          const ml = { model:dnn.describe(), prediction:{...prediction,adjustedConfidence,accepted:true}, features:{modalityCompleteness:features.modalityCompleteness,masks:features.masks} }
          return { ...cell, ml, threat:{ ...(cell.threat||{}), state:prediction.state, confidence:adjustedConfidence, method:'multimodal-pretrained-dnn', evidence:{...(cell.threat?.evidence||{}),multimodalDnn:{modelId:dnn.model.id,modelVersion:dnn.model.version,modelSha256:dnn.bundle.sha256,probabilities:prediction.probabilities,modalityCompleteness:features.modalityCompleteness,masks:features.masks}} }, state:prediction.state }
        })
      }
    }
  }
}
