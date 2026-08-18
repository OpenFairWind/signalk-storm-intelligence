'use strict'

const def = require('../inference-algorithms/llm-openai-compatible')

async function main() {
  const apiKeyEnv = process.env.STORM_LLM_API_KEY_ENV || 'OPENAI_API_KEY'
  if (!process.env[apiKeyEnv]) throw new Error(`${apiKeyEnv} is not set`)
  const algorithm = def.create({ settings: {
    baseUrl: process.env.STORM_LLM_BASE_URL || 'https://api.openai.com/v1',
    protocol: process.env.STORM_LLM_PROTOCOL || 'responses',
    model: process.env.STORM_LLM_MODEL || 'gpt-5.6-luna',
    apiKeyEnv,
    minimumConfidence: 0,
    maxEscalationLevels: 1,
    timeoutMs: Number(process.env.STORM_LLM_TIMEOUT_MS || 30000)
  } })
  const geometry={type:'Polygon',coordinates:[[[14,40],[14.1,40],[14.1,40.1],[14,40.1],[14,40]]]}
  const rows = await algorithm.infer({
    baseCells:[{trackId:'live-check-cell',geometry,severity:4,distanceMeters:12000,motion:{speed:10,confidence:.8},pathThreat:{minDistanceMeters:6000,intersects:true,interceptSec:1800,uncertaintyMeters:2500},cpa:{dcpaMeters:7000,closing:true},threat:{state:'warn',confidence:.7,evidence:{}}}],
    vessel:{position:{latitude:40.05,longitude:14.2}}, config:{horizonMinutes:60}, lightningStrikes:[], environmentContext:{available:false}, weatherApiContext:{available:false}, now:Date.now()
  })
  if (rows.length !== 1 || !rows[0].llm) throw new Error('LLM live check did not return normalized inference')
  console.log(JSON.stringify({ok:true,model:rows[0].llm.provenance?.model,assessment:rows[0].llm.assessment,threat:rows[0].threat},null,2))
}
main().catch(e=>{console.error(e.stack||e.message);process.exit(1)})
