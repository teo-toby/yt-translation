import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import local from './local'
import production from './production'
import configuration from './configuration'

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			cache: true,
			load: [ configuration, process.env.NODE_ENV === 'production' ? production :
				local ],
	  }),
	],
	providers: [ ConfigService ],
	exports: [ ConfigModule ],
})
export class CoreConfigModule {}
