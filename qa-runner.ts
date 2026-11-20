import {createForge} from './main.ts';
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const token='local-fixture', {server}=createForge(token);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const child=spawn(process.execPath,[resolve(process.argv[2],'sdk/run.ts'),'--url','http://127.0.0.1:'+server.address().port,'--token',token,'--json',...(process.argv.includes('--perf')?['--perf']:[])],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
const [code]=await new Promise(resolve=>child.on('exit',(...a)=>resolve(a)));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));writeFileSync(process.argv[3],out);if(err)console.error(err);console.log('SDK exit',code,'saved',process.argv[3]);try{const value=JSON.parse(out);console.log(JSON.stringify(value).slice(0,150));}catch{}process.exitCode=code||0;
