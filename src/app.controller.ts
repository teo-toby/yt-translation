import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common'
import { YoutubeService } from './youtube.service'
import { STTService } from './stt.service'

@Controller()
export class AppController {

	@Inject()
	private readonly youtubeService: YoutubeService
	@Inject()
	private readonly sttService: STTService

	@Get('health')
	async health() {
		return true
	}

	@Post('stt')
	async stt(@Body() body: { videoUrl: string }) {
		return await this.sttService.processYouTubeVideo(body.videoUrl)
	}

	@Post('generate-test')
	async generateTest(@Body() body: { videoId: string }) {
		const captions = await this.youtubeService.getCaption(body.videoId)
		console.log(captions)
		if (captions) {
			await this.youtubeService.callClaude(captions)
		} else {

		}

	}

}
