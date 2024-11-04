import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { CoreConfigModule } from './config/config.module'
import { AppController } from './app.controller'
import { YoutubeService } from './youtube.service'
import { STTService } from './stt.service'
@Module({
	imports: [ CoreConfigModule, HttpModule.register({
		timeout: 50000,
		maxRedirects: 2,
	}) ],
	controllers: [ AppController ],
	providers: [ YoutubeService, STTService ],
})
export class AppModule {}
