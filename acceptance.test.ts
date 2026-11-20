import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createForge} from './main.ts';
import {Store} from './store.ts';
const fixture='local-fixture';
async function serve(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;}
async function close(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
async function request(base,path,method='GET',body,auth=true){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+fixture}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,headers:r.headers,body:r.status===204?null:await r.json()};}
test('lifecycle: ephemeral port, two probes, false/errors do not end, true closes',async()=>{
 let port=0,polls=0,health=0,registeredAt=0,healthMs=0;const t=performance.now();
 const env=createServer(async(req,res)=>{if(req.url==='/register'){const chunks=[];for await(const c of req)chunks.push(c);port=JSON.parse(Buffer.concat(chunks).toString()).port;registeredAt=performance.now()-t;assert.ok(port>0&&port!==8080);const h=performance.now();for(let i=0;i<2;i++){const r=await fetch(`http://127.0.0.1:${port}/healthz`);assert.equal(r.status,200);health++;await r.json();}healthMs=performance.now()-h;res.end('{"ok":true}');}else{polls++;const r=await fetch(`http://127.0.0.1:${port}/healthz`);assert.equal(r.status,200);if(polls===1)return req.socket.destroy();if(polls===2){res.statusCode=500;res.end('{}');}else if(polls===3)res.end('broken');else res.end(JSON.stringify({done:polls>=6}));}});
 const origin=await serve(env);const child=spawn(process.execPath,[fileURLToPath(new URL('./main.ts',import.meta.url))],{env:{...process.env,MAKEFUN_ENV_URL:origin,MAKEFUN_SHOP_TOKEN:fixture},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);const timer=setTimeout(()=>child.kill(),15000);const [code]=await new Promise(resolve=>child.on('exit',(...args)=>resolve(args)));clearTimeout(timer);await close(env);assert.equal(code,0,stderr);assert.equal(health,2);assert.ok(registeredAt<20000);assert.ok(healthMs<10000);assert.equal(polls,6);console.log(JSON.stringify({registeredAt,healthMs,health,polls}));
});
test('missing env fails clearly',async()=>{const env={...process.env};delete env.MAKEFUN_ENV_URL;const child=spawn(process.execPath,[fileURLToPath(new URL('./main.ts',import.meta.url))],{env,stdio:['ignore','pipe','pipe']});const [code]=await new Promise(resolve=>child.on('exit',(...a)=>resolve(a)));assert.notEqual(code,0);});
test('REST auth, malformed JSON, ownership, stable shared state and GraphQL/MCP',async()=>{
 const {server}=createForge(fixture),base=await serve(server);try{
 assert.equal((await request(base,'/api/v3/user',undefined,undefined,false)).status,401);
 const wrong=await fetch(base+'/api/v3/user',{headers:{Authorization:'Bearer wrong'}});assert.equal(wrong.status,401);
 const malformed=await fetch(base+'/api/v3/user/repos',{method:'POST',headers:{Authorization:'Bearer '+fixture},body:'{'});assert.equal(malformed.status,400);
 const rpc=await request(base,'/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'create_repo',arguments:{name:'cross'}}});assert.equal(rpc.body.id,1);
 const repo=(await request(base,'/api/v3/repos/adaiversen/cross')).body;assert.equal(repo.owner.login,'adaiversen');assert.equal(repo.full_name,'adaiversen/cross');
 assert.equal((await request(base,'/api/v3/repos/stranger/cross')).status,404);
 const gql=await request(base,'/api/graphql','POST',{query:'{viewer{login} repository(owner:"adaiversen", name:"cross"){databaseId name}}'});assert.equal(gql.body.data.viewer.login,'adaiversen');assert.equal(gql.body.data.repository.databaseId,repo.id);
 await request(base,'/api/v3/repos/adaiversen/cross','PATCH',{description:'changed'});assert.equal((await request(base,'/api/v3/repos/adaiversen/cross')).body.description,'changed');
 await request(base,'/api/v3/repos/adaiversen/cross','DELETE');assert.equal((await request(base,'/api/v3/repos/adaiversen/cross')).status,404);
 assert.ok(repo.node_id);assert.ok(gql.headers.get('X-GitHub-Request-Id'));
 }finally{await close(server);}
});
test('domain commits/contents share git objects; conflicting merge is atomic',()=>{
 const s=new Store(),r=s.create({name:'domain'});const a=s.updateContent(r,'a.txt',{content:Buffer.from('base').toString('base64'),message:'base'}).body;
 r.refs['refs/heads/a']=a.commit.sha;r.refs['refs/heads/b']=a.commit.sha;
 for(const branch of ['a','b'])s.updateContent(r,'a.txt',{branch,sha:a.content.sha,content:Buffer.from(branch).toString('base64')});
 const p=s.pull(r,{head:'a',base:'main',title:'first'});s.merge(r,p);const before=r.refs['refs/heads/main'];assert.throws(()=>s.merge(r,s.pull(r,{head:'b',base:'main',title:'conflict'})),/conflict/i);assert.equal(r.refs['refs/heads/main'],before);
});
