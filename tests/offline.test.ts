import 'fake-indexeddb/auto'
import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {db,saveRecord,acknowledge,resolveConflict} from '../app/lib/store.ts'
import {snapshotSession,type LocalRecord} from '../shared/domain.ts'
after(async()=>db.delete())
test('Atomic local queue, isolation, immutable retry payload and acknowledgement during edits',async()=>{
 const payload={name:'Pull-up',description:'',notes:'',mode:'bodyweight' as const,videoUrl:'',videoPath:''}
 const a=await saveRecord('alice','exercise',payload),ops=await db.queue.where('owner').equals('alice').toArray()
 assert.equal(ops.length,1);assert.equal(ops[0]!.mutation.baseVersion,0)
 await saveRecord('bob','exercise',{...payload,name:'Private'})
 assert.equal((await db.records.where('user_id').equals('alice').toArray()).length,1)
 const edited=await saveRecord('alice','exercise',{...payload,name:'Updated'},{id:a.id,expectedRevision:1})
 assert.equal((await db.queue.get(ops[0]!.seq!))!.mutation.payload.name,'Pull-up')
 await acknowledge('alice',ops[0]!,{...a,version:1,revision:1})
 const local=await db.records.get(['alice',a.id]);assert.equal((local!.payload as any).name,'Updated');assert.equal(local!.dirty,true)
 const next=(await db.queue.where('owner').equals('alice').toArray())[0]!
 assert.equal(next.mutation.baseVersion,1)
 await assert.rejects(()=>saveRecord('alice','exercise',payload,{id:a.id,expectedRevision:1}),/altra finestra|altra|finestra/)
 await db.records.update(['alice',a.id],{conflict:{...a,version:4,payload:{...payload,name:'Remote'}}})
 await resolveConflict('alice',a.id,true)
 const resolved=(await db.queue.where('owner').equals('alice').toArray())[0]!
 assert.equal(resolved.mutation.baseVersion,4);assert.equal((resolved.mutation.payload as any).name,'Updated')
 assert.notEqual(resolved.mutation.operationId,next.mutation.operationId)
 assert.equal(edited.localRevision,2)
})
test('Sessions snapshot targets, leave perceived values empty and preserve original exercise',()=>{
 const row={id:crypto.randomUUID(),parent_id:crypto.randomUUID(),payload:{name:'Upper',notes:'',order:0,exercises:[{id:crypto.randomUUID(),exerciseId:crypto.randomUUID(),name:'Pull-up',notes:'Explosive',mode:'weighted',band:'',alternatives:[],sets:[{reps:6,rpe:8,rir:2,tut:null,load:10}]}]}} as LocalRecord
 const session=snapshotSession(row,74.8)
 ;(row.payload as any).exercises[0].sets[0].reps=12
 assert.equal(session.exercises[0]!.targetSets[0]!.reps,6)
 assert.equal(session.exercises[0]!.actual[0]!.rpe,null)
 assert.equal(session.exercises[0]!.originalName,'Pull-up')
 assert.equal(session.bodyWeight,74.8)
})
