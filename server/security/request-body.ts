import type { IncomingMessage } from 'node:http'
import type { H3Event } from 'h3'

const RAW_BODY_SYMBOL = Symbol.for('h3RawBody')

class RequestBodyTooLargeError extends Error {}

type CachedRequest = IncomingMessage & { [key: symbol]: unknown }

/**
 * H3 1.x buffers request bodies without a byte ceiling. Read the Node stream
 * once here, stop retaining chunks at the configured limit, and put the
 * resulting promise in H3's own raw-body cache for downstream parsers.
 */
export async function enforceBoundedRequestBody(event: H3Event, maximumBytes: number) {
  const request = event.node.req as CachedRequest
  const declaredLength = Number(request.headers['content-length'] ?? 0)
  const chunked = /\bchunked\b/i.test(String(request.headers['transfer-encoding'] ?? ''))
  if (!declaredLength && !chunked) return

  const cached = request[RAW_BODY_SYMBOL]
  if (cached) {
    const body = await Promise.resolve(cached)
    if (Buffer.isBuffer(body) && body.byteLength > maximumBytes) throw tooLarge()
    return
  }

  const body = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    const cleanup = () => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      request.off('aborted', onAborted)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onAborted = () => onError(new Error('Request body was aborted.'))
    const onEnd = () => {
      cleanup()
      resolve(Buffer.concat(chunks, size))
    }
    const onData = (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      size += chunk.byteLength
      if (size > maximumBytes) {
        cleanup()
        // Drain the remainder without retaining it so keep-alive connections
        // can still be reused and a large chunked upload cannot grow memory.
        request.once('error', () => {})
        request.resume()
        reject(new RequestBodyTooLargeError())
        return
      }
      chunks.push(chunk)
    }

    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    request.once('aborted', onAborted)
  })

  request[RAW_BODY_SYMBOL] = body
  try {
    await body
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw tooLarge()
    throw error
  }
}

function tooLarge() {
  return createError({ statusCode: 413, statusMessage: 'Request body is too large.' })
}
