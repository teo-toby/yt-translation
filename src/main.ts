import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
// eslint-disable-next-line @typescript-eslint/no-var-requires

async function bootstrap() {
	const nestApp = await NestFactory.create(AppModule)
	await nestApp.listen(process.env.PORT || 8001)
	console.log(`task server start port : ${process.env.PORT || 8001}`)
}

bootstrap()
