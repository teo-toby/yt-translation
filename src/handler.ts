import { NestFactory } from '@nestjs/core'
import { Callback, Context, Handler } from 'aws-lambda'
import { AppModule } from './app.module'
import _ from 'lodash'
import { YoutubeService } from './youtube.service'

interface EventBody {
	target: string
	target_id: any
	data: any
}

export const handler: Handler = async (
	event: EventBody,
	_context: Context,
	callback: Callback,
) => {
	console.log(callback)
	switch (event.target) {
		case 'test':
			await test(event)
			break
	}
}

const test = async (event: EventBody) => {
	const { } = event.data
	const appContext = await NestFactory.createApplicationContext(AppModule)
	const youtubeService = appContext.get(YoutubeService)
	await youtubeService.test()
}
