import * as dog from 'dog';

export { DogGroup } from './dog/group';
export { DogReplica } from './dog/replica'

// @ts-ignore
import indexHtml from "./index.html"

export type Env = {
  KV_BUTTONS: KVNamespace
  DOG_GROUP: DurableObjectNamespace & dog.Group<Env>
  DOG_REPLICA: DurableObjectNamespace & dog.Replica<Env>
}

export default {
  async fetch(request: Request, env: Env, ctx:ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const streamDeckId = url.pathname.substring(1)

    // redirect to a new Stream Deck ID for /new
    if (streamDeckId == "new") {
      return Response.redirect(`${url.protocol}//${url.hostname}:${url.port}/${env.DOG_GROUP.newUniqueId().toString()}`)
    }

    // handle WebSocket requests by DOG
    if (request.headers.get("upgrade") === "websocket" || ["POST", "PATCH"].includes(request.method)) {
      // reqid identifies a user, we can use UUIDv4 for each connection
      let reqid = crypto.randomUUID()

      let gid = streamDeckId ? env.DOG_GROUP.idFromString(streamDeckId) : env.DOG_GROUP.idFromName('homepage');
      console.log(streamDeckId, gid.toString())
      let group = await dog.identify(gid, reqid, {
        parent: env.DOG_GROUP,
        child: env.DOG_REPLICA,
      });
  
      return group.fetch(`http://internal/${gid.toString()}`, request);
    }

    if (request.headers.get("accept")?.includes("text/html")) {
      ctx.waitUntil(incrementCounter(env))
    }
    // serve HTML interface otherwise
    const type = url.searchParams.get("type")
    let format = ""
    switch (type) {
      case "r3c5": format = "r3c5"; break;
      case "r2c3": format = "r2c3"; break;
      default: format = "r4c8";
    }
    return new Response(indexHtml.replaceAll("__FORMAT__", format), {
      headers: {
        "content-type": "text/html"
      }
    })
  }
}

async function incrementCounter(env:Env) {
  // @ts-ignore
  await fetch("https://streamdeck-proxy.eidamd.workers.dev")
  return
}
