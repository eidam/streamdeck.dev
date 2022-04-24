import { Replica } from 'dog';
import type { Socket, Gossip } from 'dog';
import { Env } from '..';

type Message = {
	uid: string;
	type: string;
};

type MessageData =
	| { type: 'msg'; text: string }
	| { type: 'ping', id: string };

export class DogReplica extends Replica<Env> {
	users = new Map<string, number>();
	clusterUsers = 0
	storage: DurableObjectStorage

	// temporary counter for testing Durable Objects alarms
	alarmCounter = 0

	constructor(state:DurableObjectState, env:Env) {
		super(state, env);
		this.storage = state.storage
	}

	link(env: Env) {
		return {
			parent: env.DOG_GROUP,
			self: env.DOG_REPLICA,
		};
	}

	async receive(req: Request) {
		console.log('[ HELLO ][receive] req.url', req.url);
        return this.connect(req);
	}

	onopen(socket: Socket) {
		console.log('[ HELLO ][onopen]', socket.uid);
	}

	onclose(socket: Socket) {
		console.log('[ HELLO ][onclose]');
	}

	async onmessage(socket: Socket, data: string) {
		// raw broadcast channel
		let input = JSON.parse(data) as Message & MessageData;
		console.log('[room] onmessage', input);
		input.uid = input.uid || socket.uid;

		console.log(JSON.stringify(input))
	}
}

function getDoStub(binding:DurableObjectNamespace, doName: string) {
	return binding.get(binding.idFromName(doName))
}