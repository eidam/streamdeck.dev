import * as dog from 'dog';

export { DogGroup } from './dog/group';
export { DogReplica } from './dog/replica'

// @ts-ignore
import indexHtml from "./index.html"

export type Env = {
  DOG_GROUP: DurableObjectNamespace & dog.Group<Env>,
  DOG_REPLICA: DurableObjectNamespace & dog.Replica<Env>
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // handle WebSocket requests by DOG
    if (request.headers.get("upgrade") === "websocket") {
      // reqid identifies a user
      let reqid = "anon"

      // gid would be stream interface id
      let gid = env.DOG_GROUP.idFromName('homepage');
  
      let group = await dog.identify(gid, reqid, {
        parent: env.DOG_GROUP,
        child: env.DOG_REPLICA,
      });
  
      return group.fetch(request);
    }

    // serve HTML otherwise
    return new Response(indexHtml, {
      headers: {
        "content-type": "text/html"
      }
    })
  }
}