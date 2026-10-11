import { createClient } from '@supabase/supabase-js'
import type { FastifyInstance, FastifyRequest } from 'fastify'
export const config = () => ({url:process.env.SUPABASE_URL||'',key:process.env.SUPABASE_PUBLISHABLE_KEY||''})
export function userClient(token:string) {const {url,key}=config();return createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`},fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
export function serverClient(){const {url}=config(),key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)throw Object.assign(new Error('Backend non configurato'),{statusCode:503});return createClient(url,key,{global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
export const bearer = (request:FastifyRequest) => /^Bearer ([^\s]+)$/.exec(request.headers.authorization||'')?.[1]
export async function authenticate(request:FastifyRequest) {
 const token=bearer(request);if(!token)throw Object.assign(new Error('Accesso richiesto'),{statusCode:401})
 if(!config().url||!config().key)throw Object.assign(new Error('Supabase non configurato'),{statusCode:503})
 const db=userClient(token),{data,error}=await db.auth.getUser(token)
 if(error||!data.user)throw Object.assign(new Error('Sessione scaduta. Accedi di nuovo.'),{statusCode:401})
 return {token,db:serverClient(),userId:data.user.id}
}
export function errors(app:FastifyInstance){app.setErrorHandler((error:any,_req,reply)=>{const status=error.statusCode||500;reply.code(status).send({error:status>=500?'Servizio temporaneamente non disponibile':error.message})})}
