import { Group } from 'dog';
import { Env } from '..';

export class DogGroup extends Group<Env> {
	limit = 10; // max conns per REPLICA stub

	link(env: Env) {
		return {
			child: env.DOG_REPLICA,
			self: env.DOG_GROUP,
		};
	}

	// Optional: Only create REPLICAs in the "eu" jurisdiction
	// clusterize(req: Request, target: DurableObjectNamespace): DurableObjectId {
	// 	return target.newUniqueId({ jurisdiction: 'eu' });
	// }
}