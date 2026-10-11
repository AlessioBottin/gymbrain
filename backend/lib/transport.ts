import type { FastifyInstance, HTTPMethods } from 'fastify'
export interface ModuleRequest {
  method: HTTPMethods
  path: string
  token: string
  body?: unknown
}
export interface ModuleResponse {
  status: number
  body: any
}
export interface Transport {
  request(input: ModuleRequest): Promise<ModuleResponse>
}
export function localTransport(app: FastifyInstance): Transport {
  return {
    async request({ method, path, token, body }) {
      const response = await app.inject({
        method,
        url: path,
        headers: { authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { payload: body as any }),
      })
      return { status: response.statusCode, body: response.json() }
    },
  }
}
export function httpTransport(origin: string): Transport {
  return {
    async request({ method, path, token, body }) {
      const response = await fetch(new URL(path, origin), {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      })
      return { status: response.status, body: await response.json() }
    },
  }
}
