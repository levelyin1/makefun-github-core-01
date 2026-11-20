import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {Store,Failure} from './store.ts';
import {rest} from './rest.ts';
import {graphql} from './graphql.ts';
import {mcp} from './mcp.ts';
import {git} from './git.ts';
export function createForge(token){const store=new Store();let seq=0;
 const server=createServer(async(req,res)=>{const headers={'Content-Type':'application/json','X-GitHub-Request-Id':String(++seq),'X-OAuth-Scopes':'repo, read:user'};
 const send=({status=200,body,raw,headers:extra={}})=>{const data=raw??Buffer.from(body===undefined?'':JSON.stringify(body));res.writeHead(status,{...headers,...extra,'Content-Length':data.length});res.end(data);};
 try{const url=new URL(req.url,'http://entry'),method=req.method;
  if(url.pathname==='/healthz')return send({body:{ok:true}});
  if(!token||req.headers.authorization!==`Bearer ${token}`)return send({status:401,body:{message:'Bad credentials'}});
  const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>64*1024*1024)throw new Failure(413,'Body too large');chunks.push(part);}const raw=Buffer.concat(chunks);
  const match=url.pathname.match(/^\/([^/]+)\/([^/]+)\.git\//);if(match){const r=store.repo(decodeURIComponent(match[1]),decodeURIComponent(match[2]));return send(git(store,r,method,url,req.headers,raw));}
  let x={};if(raw.length){try{x=JSON.parse(raw.toString());}catch{if(url.pathname==='/mcp')return send({status:400,body:{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}});throw new Failure(400,'Malformed JSON');}}
  if(url.pathname==='/api/graphql')return send({body:graphql(store,x)});
  if(url.pathname==='/mcp'){const body=mcp(store,x);return send(body===null?{status:202}:{body});}
  if(url.pathname.startsWith('/api/v3'))return send(rest(store,method,url,x,`http://${req.headers.host}`));
  throw new Failure(404,'Not Found');
 }catch(e){send({status:e.status||500,body:{message:e.status?e.message:'Internal error'}});}});
 return {server,store};
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function lifecycle(env=process.env){if(!env.MAKEFUN_ENV_URL)throw Error('MAKEFUN_ENV_URL required');const base=new URL(env.MAKEFUN_ENV_URL);if(!['http:','https:'].includes(base.protocol))throw Error('Invalid env origin');
 const {server}=createForge(env.MAKEFUN_SHOP_TOKEN);await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));const {port}=server.address();let registered=false;
 try{for(let i=0;i<6;i++){try{const r=await fetch(new URL('/register',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({port}),signal:AbortSignal.timeout(1500)});if(r.ok){const value=await r.json();if(value.ok!==true)throw Error('Registration invalid');registered=true;break;}if(r.status>=400&&r.status<500)throw new Failure(r.status,'Registration refused');}catch(e){if(e instanceof Failure)throw e;}await sleep(Math.min(100*2**i,1000));}if(!registered)throw Error('Registration failed');
  for(;;){try{const r=await fetch(new URL('/done',base),{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).done===true)break;}catch{}await sleep(200);}
 }finally{await new Promise(resolve=>server.close(resolve));}
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)lifecycle().catch(e=>{console.error(e.message);process.exitCode=1;});
