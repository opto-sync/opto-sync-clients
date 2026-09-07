import { createHash } from 'node:crypto';
export const CONTRACT_IR_SCHEMA='ores.typespec-json-schema-validator.contract-ir/v1';
export const PARITY_REPORT_SCHEMA='ores.typespec-json-schema-validator.report/v1';
const HEX=/^[a-f0-9]{64}$/u;
const obj=(v)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function need(c,m){if(!c)throw new Error(`contract-ir admission rejected: ${m}`);}
// Match the canonical producer's JSON digest, not schema comparison semantics.
// Array order/multiplicity and own __proto__ keys are part of the evidence.
function canon(v){
 if(Array.isArray(v))return v.map(canon);
 if(!obj(v))return v;
 return Object.fromEntries(Object.keys(v).sort().map((key)=>[key,canon(v[key])]));
}
export const canonicalStringify=(v)=>JSON.stringify(canon(v));
export const sha256Json=(v)=>createHash('sha256').update(canonicalStringify(v)).digest('hex');
function digest(v,l){need(typeof v==='string'&&HEX.test(v),`${l} must be a lowercase SHA-256 digest`);return v;}
// Envelope-integrity check only: callers supply independently measured input digests.
// This does not recompile TypeSpec or establish semantic parity. Promotion also
// requires the canonical current-source verifier used by the repository workflow.
export function verifyContractIrAdmission({contractIr,parityReport,expectedInputs,requireComplete=true}){
 need(obj(contractIr),'contractIr must be an object'); need(obj(parityReport),'parityReport must be an object'); need(obj(expectedInputs),'expectedInputs is required');
 need(typeof requireComplete==='boolean','requireComplete must be boolean');
 need(contractIr.schema===CONTRACT_IR_SCHEMA,'unexpected Contract IR schema'); need(contractIr.status==='passed','Contract IR status must be passed'); need(contractIr.admissible===true,'Contract IR must be admissible'); need(contractIr.role==='downstream-derived-parity-artifact','Contract IR role is invalid'); need(contractIr.editableAuthority===false,'Contract IR must not be an editable authority');
 need(contractIr.authorities?.typespec==='independently-authored','TypeSpec must remain independently authored'); need(contractIr.authorities?.jsonSchema==='independently-authored','JSON Schema must remain independently authored'); need(contractIr.authorities?.generatedJsonSchema==='comparison-evidence-only','generated JSON Schema must remain comparison evidence only'); need(contractIr.authorities?.precedence==='none','peer authorities must have no precedence');
 need(parityReport.schema===PARITY_REPORT_SCHEMA,'unexpected parity report schema'); need(parityReport.status==='passed','parity report status must be passed'); need(parityReport.zeroUnexplainedFindings===true,'parity report must have zero unexplained findings'); need(Array.isArray(parityReport.findings)&&parityReport.findings.length===0,'parity report findings must be empty'); digest(parityReport.runId,'parityReport.runId');
 const receipt=contractIr.admission?.receipt; need(obj(receipt),'Contract IR receipt is missing'); need(receipt.schema===parityReport.schema,'receipt schema does not match parity report'); need(receipt.runId===parityReport.runId,'receipt runId does not match parity report'); need(receipt.status==='passed','receipt status must be passed'); need(receipt.zeroUnexplainedFindings===true,'receipt must bind zero unexplained findings'); need(receipt.digest===sha256Json(parityReport),'receipt digest does not match the supplied parity report');
 const id=digest(contractIr.irId,'contractIr.irId'); const body={...contractIr}; delete body.irId; need(id===sha256Json(body),'Contract IR self digest does not match its body');
 for(const key of ['typespec','authoredJsonSchema','generatedJsonSchema']){const e=digest(expectedInputs[key],`expectedInputs.${key}`);const r=digest(parityReport.inputs?.[key]?.digest,`parityReport.inputs.${key}.digest`);const p=digest(contractIr.provenance?.[key]?.digest,`contractIr.provenance.${key}.digest`);need(r===e,`${key} parity-report digest is stale for this checkout`);need(p===e,`${key} Contract IR digest is stale for this checkout`);}
 if(requireComplete)need(contractIr.admission?.scope?.complete===true,'consumer requires a complete Contract IR scope');
 need(Array.isArray(contractIr.declarations)&&contractIr.declarations.length>0,'Contract IR declarations must be nonempty');
 const ids=new Set();
 for(const d of contractIr.declarations){need(obj(d),'Contract IR declaration must be an object');need(typeof d.id==='string'&&d.id.trim().length>0&&!ids.has(d.id),'declaration IDs must be nonempty and unique');ids.add(d.id);need(obj(d.assertionSchema)||typeof d.assertionSchema==='boolean','declaration assertionSchema is invalid');digest(d.assertionDigest,`declaration ${String(d.id)} assertionDigest`);need(d.assertionDigest===sha256Json(d.assertionSchema),`declaration ${String(d.id)} assertion digest is invalid`);need(d.lanes?.typespecGeneratedJsonSchema?.role==='comparison-evidence-only',`declaration ${String(d.id)} generated lane role is invalid`);need(d.lanes?.authoredJsonSchema?.role==='independently-authored-authority',`declaration ${String(d.id)} authored lane role is invalid`);}
 return Object.freeze({admitted:true,verificationScope:'envelope-integrity-only',irId:contractIr.irId,runId:parityReport.runId,inputs:Object.freeze({...expectedInputs})});
}
