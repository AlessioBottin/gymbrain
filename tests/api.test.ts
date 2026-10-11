import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createApp} from '../backend/app.ts'
import {createRecordsModule} from '../backend/modules/records.ts'
import {localTransport,httpTransport} from '../backend/lib/transport.ts'
test('Public gateway rejects missing credentials and does not forward user-supplied identity',async()=>{
 const calls:any[]=[];const app=await createApp({transports:{training:{async request(r){calls.push(r);return {status:200,body:{ok:true}}}},tracking:{async request(){throw new Error('Unexpected')}}}})
 try{assert.equal((await app.inject('/api/training/records')).statusCode,401)
 const response=await app.inject({url:'/api/training/records',headers:{authorization:'Bearer test','x-user-id':'someone-else'}})
 assert.equal(response.statusCode,200);assert.equal(calls[0].token,'test');assert.equal(calls[0].userId,undefined)
 assert.equal((await app.inject('/api/missing')).statusCode,404)
 }finally{await app.close()}
})
test('Module contract works identically over inject and HTTP; validates payloads',async()=>{
 const query:any={select:()=>query,eq:(column:string,owner:string)=>{assert.equal(column,'user_id');assert.equal(owner,'alice');return query},gt:()=>query,order:()=>query,limit:async()=>({data:[],error:null})}
 const module=createRecordsModule('training',async()=>({userId:'alice',token:'test',db:{from:()=>query,rpc:async(_name:string,args:any)=>{assert.equal(args.owner_id,'alice');return {data:{conflict:false,record:{id:'ok'}},error:null}}} as any}))
 try{await module.listen({host:'127.0.0.1',port:0});const address=module.server.address() as any
 const local=localTransport(module),http=httpTransport('http://127.0.0.1:'+address.port)
 const request={method:'GET' as const,path:'/records?after=0',token:'test'}
 assert.deepEqual(await local.request(request),await http.request(request))
 const invalid={method:'POST' as const,path:'/mutations',token:'test',body:{user_id:'forged'}}
 assert.equal((await local.request(invalid)).status,400)
 assert.equal((await http.request(invalid)).status,400)
 const valid={method:'POST' as const,path:'/mutations',token:'test',body:{operationId:crypto.randomUUID(),id:crypto.randomUUID(),kind:'exercise',parentId:null,baseVersion:0,deleted:false,payload:{name:'Pull-up',description:'',notes:'',mode:'bodyweight',videoUrl:'',videoPath:''}}}
 assert.equal((await local.request(valid)).status,200)
 assert.equal((await http.request(valid)).status,200)
 }finally{await module.close()}
})
