import {viewer,fail} from './store.ts';
export function rest(store,method,url,x,origin){
 const a=url.pathname.replace(/^\/api\/v3\/?/,'').split('/').map(decodeURIComponent),q=url.searchParams;
 const page=list=>{const size=Math.max(1,Math.min(100,Number(q.get('per_page'))||30)),p=Math.max(1,Number(q.get('page'))||1),start=(p-1)*size;const next=new URL(url);next.searchParams.set('page',String(p+1));return {status:200,body:list.slice(start,start+size),headers:start+size<list.length?{Link:`<${origin}${next.pathname}${next.search}>; rel="next"`}:{}};};
 if(!a[0])return {body:{current_user_url:origin+'/api/v3/user'}};
 if(a[0]==='meta')return {body:{installed_version:'3.13.0'}};
 if(a[0]==='user'&&a.length===1)return {body:viewer};
 if(a[0]==='user'&&a[1]==='repos'){if(method==='POST'){const r=store.create(x);return {status:201,body:store.view(r)};}return page([...store.repos.values()].map(r=>store.view(r)));}
 if(a[0]!=='repos'||a.length<3)fail(404,'Not Found');const r=store.repo(a[1],a[2]),tail=a.slice(3);
 if(!tail.length){if(method==='DELETE'){store.repos.delete(r.full_name);return {status:204};}if(method==='PATCH'){for(const k of ['description','private','default_branch'])if(k in x)r[k]=x[k];}return {body:store.view(r)};}
 const branch=q.get('sha')||q.get('ref')||r.default_branch;
 if(tail[0]==='contents'){const path=tail.slice(1).join('/');if(method==='PUT'||method==='DELETE')return store.updateContent(r,path,x,method==='DELETE');return {body:store.content(r,path,q.get('ref'))};}
 if(tail[0]==='git'&&tail[1]==='refs'){
  if(method==='POST'){if(!/^refs\/(heads|tags)\/.+/.test(x.ref)||!store.objects.has(x.sha))fail(422,'Invalid ref');if(r.refs[x.ref])fail(422,'Ref exists');r.refs[x.ref]=x.sha;return {status:201,body:{ref:x.ref,object:{sha:x.sha}}};}
  const ref=tail.slice(2).join('/');if(!ref)return {body:Object.entries(r.refs).map(([ref,sha])=>({ref,object:{sha}}))};const sha=r.refs['refs/'+ref];if(!sha)fail(404,'Not Found');return {body:{ref:'refs/'+ref,object:{sha}}};}
 if(tail[0]==='branches'){const list=Object.entries(r.refs).filter(([k])=>k.startsWith('refs/heads/')).map(([k,sha])=>({name:k.slice(11),commit:{sha}}));if(tail.length>1){const b=list.find(b=>b.name===tail.slice(1).join('/'));if(!b)fail(404,'Not Found');return {body:b};}return page(list);}
 if(tail[0]==='commits'){let at=store.tip(r,branch);const list=[],seen=new Set();while(at&&!seen.has(at)){seen.add(at);const c=store.commit(at);if(!c)break;list.push({sha:at,commit:{message:c.message},parents:c.parents.map(sha=>({sha}))});at=c.parents[0];}return page(list);}
 if(tail[0]==='labels'){if(method==='POST'){if(!x.name)fail(422,'Label name required');const l={id:store.serial++,name:x.name,color:x.color||'ffffff'};r.labels.push(l);return {status:201,body:l};}return page(r.labels);}
 if(tail[0]==='issues'||tail[0]==='pulls'){
  const isPull=tail[0]==='pulls',list=isPull?r.pulls:r.issues;
  if(tail.length===1){if(method==='POST')return {status:201,body:isPull?store.pull(r,x):store.issue(r,x)};let rows=list.filter(i=>(q.get('state')||'open')==='all'||i.state===(q.get('state')||'open'));rows=[...rows].sort((a,b)=>(q.get('direction')==='asc'?1:-1)*(a.number-b.number));return page(rows);}
  const item=list.find(i=>i.number===Number(tail[1]));if(!item)fail(404,'Not Found');
  if(tail[2]==='comments'){if(method==='POST')return {status:201,body:store.comment(item,x)};return page(item._comments||[]);}
  if(tail[2]==='files')return {body:store.changes(item)};
  if(tail[2]==='merge')return {body:store.merge(r,item)};
  if(method==='PATCH'){for(const k of ['state','title','body'])if(k in x)item[k]=x[k];}
  return {body:item};
 }
 fail(404,'Not Found');
}
