import { Replica } from 'dog';
import type { Socket, Gossip } from 'dog';
import { Env } from '..';

type Message = {
	type: string
	uid: string
}

type MessageData =
	| { type: 'init'; data: { pluginUUID: string } }
	| { type: 'buttonLocationsUpdates', data: { buttonLocations: Record<string, any> } }
	| { type: 'setButton', data: ButtonConfig}
	| { type: 'rawSD', data: { action: string, context: string, device: string, event: string, payload: {coordinates: ButtonCoordinates}}}

type ButtonCoordinates = {
	row: number
	column: number
}

type ButtonEvent = {
	event: string
	broadcast: boolean
}

type ButtonEventPayload = 
	| {event: "openUrl", payload: { url: string } } 
	| {event: "setTitle", payload: { title: string } } 
	| {event: "setImage", payload: { image: string } } 
	| {event: "fetch", payload: { url: string } } 
	| {event: "fetchEvents", payload: { url: string } } 
	| {event: "showOk", payload: {} } 
	| {event: "showAlert", payload: {} } 

type ButtonConfig = {
	coordinates: ButtonCoordinates,
	title: string,
	image: string, // base64 encoded image (select from preselected on frontend)
	events: Array<ButtonEvent & ButtonEventPayload>, // list of events, e.g. openUrl, showOk, by default showOk, or showUrl
	
	// TODO auto pull of fetchEvents
	autoRefresh?: {
		every: number
		url: string
	}
}

const allowedEvents = [
	"openUrl",
	"setTitle",
	"setImage",
	"fetch",
	"fetchEvents",
	"showOk",
	"showAlert"
]

const allowedSocketEvents = [
	"openUrl",
	"setTitle",
	"setImage",
	"showOk",
	"showAlert"
]

const allowedBroadcastEvents = [
	"setTitle",
	"setImage",
	"showOk",
	"showAlert"
]

export class DogReplica extends Replica<Env> {
	env: Env
	replicaUsers = new Map<string, number>();
	streamDeckId = ""

	constructor(state:DurableObjectState, env:Env) {
		super(state, env);
		this.env = env
	}

	link(env: Env) {
		return {
			parent: env.DOG_GROUP,
			self: env.DOG_REPLICA,
		};
	}

	async receive(req: Request) {
		const url = new URL(req.url)
		this.streamDeckId = url.pathname.substring(1)

		// just update the button from an API
		if (["POST", "PATCH"].includes(req.method) && this.streamDeckId) {
			const buttonConfig = await req.json() as ButtonConfig
			if (
				typeof buttonConfig.coordinates?.row !== 'number' 
				|| typeof buttonConfig.coordinates?.column !== 'number' 
				|| (!buttonConfig.title && req.method === "POST")
			)
				return new Response("Bad request", {status: 400})
			
			let updatedButtonConfig = buttonConfig
			if (req.method === "PATCH") {
				const kvButtonConfig = await this.getButtonSettings(buttonConfig.coordinates?.row, buttonConfig.coordinates?.column)
				updatedButtonConfig = {...kvButtonConfig, ...updatedButtonConfig}
			}
			this.updateButton(undefined, buttonConfig)
			this.setButtonConfig(updatedButtonConfig)
			
			return new Response("button saved :shrug:")
		}
		//console.log('[ HELLO ][receive] req.url', req.url);
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
		//console.log('[room] onmessage', input);
		input.uid = input.uid || socket.uid;

		if (input.type === "rawSD") {
			// get buttonSettings (from KV)
			const buttonConfig:ButtonConfig = await this.getButtonSettings(input.data.payload.coordinates.row, input.data.payload.coordinates.column) 
				|| {title: "", image: "", coordinates: input.data.payload.coordinates} // default button settings

			if (!buttonConfig) return

			if (input.data.event === "willAppear") {
				this.updateButton(socket, buttonConfig)
			}

			// pressed button, the only action when we process events
			if (input.data.event === "keyUp") {
				this.processButtonEvents(socket, buttonConfig)
			}
		}
	}

	async getButtonSettings(row:number, column:number) {
		return <ButtonConfig> await this.env.KV_BUTTONS.get(`sd/${this.streamDeckId}/${row}_${column}`, "json")
	}

	async setButtonConfig(buttonSettings: ButtonConfig) {
		return await this.env.KV_BUTTONS.put(`sd/${this.streamDeckId}/${buttonSettings.coordinates.row}_${buttonSettings.coordinates.column}`, JSON.stringify(buttonSettings))
	}

	updateButton(socket: Socket | undefined, buttonConfig:ButtonConfig) {
		if (socket) {
			if (buttonConfig.title)
				socket.send(JSON.stringify({
					event: "setTitle",
					coordinates: buttonConfig.coordinates,
					payload: buttonConfig
				}))
			
			if (buttonConfig.image)
				socket.send(JSON.stringify({
					event: "setImage",
					coordinates: buttonConfig.coordinates,
					payload: buttonConfig
				}))
		} else {
			if (buttonConfig.title)
				this.broadcast(JSON.stringify({
					event: "setTitle",
					coordinates: buttonConfig.coordinates,
					payload: buttonConfig
				}))
			if (buttonConfig.image)
				this.broadcast(JSON.stringify({
					event: "setImage",
					coordinates: buttonConfig.coordinates,
					payload: buttonConfig
				}))
		}
	}

	// on autoRefresh socket is undefined, so forced broadcast in that case
	processButtonEvents(socket: Socket | undefined, buttonConfig:ButtonConfig) {
		let saveButtonConfig = false
		if (buttonConfig?.events?.length) {
			buttonConfig.events.filter(e => allowedEvents.includes(e.event)).forEach(event => {
				// fetch and execute events from remote endpoint
				if (event.event === "fetch") {
					fetch(event.payload.url)
				} else if (event.event === "fetchEvents") {
					fetch(event.payload.url)
						.then(res => res.json())
						.then(json => {
							// @ts-ignore
							if (!json || !json.events?.length) return
							// TODO fetchEventsApiResponse type
							// @ts-ignore
							const events = json.events as Array<ButtonEvent & ButtonEventPayload>

							// fetch event method can do limited things
							const filteredEvents = events.filter(e => (e.broadcast ? allowedBroadcastEvents : allowedSocketEvents).includes(e.event))
							filteredEvents.forEach(e => {
								switch (e.event) {
									case "setTitle": buttonConfig.title = e.payload.title; saveButtonConfig = true; break;
									case "setImage": buttonConfig.image = e.payload.image; saveButtonConfig = true; break;
								}

								if (socket && !e.broadcast) {
									socket.send(JSON.stringify({...e, coordinates: buttonConfig.coordinates}))
								} else {
									this.broadcast(JSON.stringify({...e, coordinates: buttonConfig.coordinates}))
								}
							})
						})
				} else {
					switch (event.event) {
						case "setTitle": buttonConfig.title = event.payload.title; saveButtonConfig = true; break;
						case "setImage": buttonConfig.image = event.payload.image; saveButtonConfig = true; break;
					}

					if (socket && !event.broadcast) {
						socket.send(JSON.stringify({...event, coordinates: buttonConfig.coordinates}))
					} else {
						this.broadcast(JSON.stringify({...event, coordinates: buttonConfig.coordinates}))
					}
				}
			})
		}

		if (saveButtonConfig) {
			this.setButtonConfig(buttonConfig)
		}
	}

}