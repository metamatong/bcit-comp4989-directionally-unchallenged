/** Render model text safely as text, alongside provenance and source crops. No inference on page load. */
const results = await Promise.all(['qwen-focused-trial.json','focused-trial.json'].map(async file => {
 const response=await fetch('/local-analysis/'+file);if(!response.ok)throw Error('Trial unavailable: '+file);return response.json();
})).catch(error=>{document.getElementById('status').textContent=String(error);return null;});
if(results){
 document.getElementById('status').textContent=results.map(r=>`${r.model}: ${r.status}, ${r.observations.length} crops, ${Math.round(r.observations.reduce((sum,o)=>sum+(o.elapsedMs||0),0)/1000)} seconds of requests`).join(' · ');
 const ids=[...new Set(results.flatMap(r=>r.observations.map(o=>o.id)))];
 for(const id of ids){
  const observations=results.map(r=>({model:r.model,entry:r.observations.find(o=>o.id===id)}));const first=observations.find(o=>o.entry)?.entry;if(!first)continue;
  const card=document.createElement('article');card.className='evidence';const title=document.createElement('h3');title.textContent=id+' · '+first.planId;const img=document.createElement('img');img.src='/local-analysis/'+first.cropFile;img.alt='Original source crop '+id+'; '+first.rotation+' degree rotation';card.append(title,img);
  for(const {model,entry} of observations){const p=document.createElement('p');p.className='result';p.textContent=model+'\n'+(entry?JSON.stringify(entry.result??{error:entry.error??entry.status},null,2):'Not processed');card.append(p);}
  const provenance=document.createElement('details');const label=document.createElement('summary');label.textContent='Source and crop provenance';const content=document.createElement('p');content.className='result';content.textContent=JSON.stringify({sourceSha256:first.sourceSha256,cropSha256:first.cropSha256,normalizedBounds:first.bounds,rotation:first.rotation,routeEligible:false},null,2);provenance.append(label,content);card.append(provenance);document.getElementById('evidence').append(card);
 }
}
