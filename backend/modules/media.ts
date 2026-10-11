import Fastify from 'fastify'
import {z} from 'zod'
import {authenticate,errors} from '../lib/auth.ts'
export function createMediaModule(){const app=Fastify();errors(app)
 app.post('/upload-url',async(req,reply)=>{const {db,userId}=await authenticate(req);const parsed=z.object({type:z.enum(['video/mp4','video/webm','video/quicktime']),size:z.number().int().positive().max(25*1024*1024)}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'Video non valido: massimo 25 MB'});const ext={'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'}[parsed.data.type],path=`${userId}/${crypto.randomUUID()}.${ext}`;const {data,error}=await db.storage.from('exercise-videos').createSignedUploadUrl(path,{upsert:false});if(error)throw error;return {path,token:data.token}})
 app.post('/download-url',async(req,reply)=>{const {db,userId}=await authenticate(req);const parsed=z.object({path:z.string().max(200)}).strict().safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'Percorso non valido'});const path=parsed.data.path;if(!path.startsWith(userId+'/')||!new RegExp('^'+userId+'/[0-9a-f-]+\\.(mp4|webm|mov)$').test(path))return reply.code(403).send({error:'Accesso negato'});const {data,error}=await db.storage.from('exercise-videos').createSignedUrl(path,300);if(error)throw error;return {url:data.signedUrl}})
 return app}
