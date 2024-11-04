import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { YoutubeTranscript } from 'youtube-transcript'
import Anthropic from '@anthropic-ai/sdk'
import { sleep } from './utils'
import he from 'he'

@Injectable()
export class YoutubeService {

	private readonly MAX_TOKENS = 8192
	private readonly TEMPERATURE = 0.8
	private readonly MAX_RETRY_CNT = 2

	@Inject()
	private readonly configService: ConfigService

	async test() {
		return 'test'
	}

	decodeHTMLEntities(text: string) {
		const tempElement = document.createElement('textarea')
		tempElement.innerHTML = text
		return tempElement.value
	}

	async getCaption(videoId: string) {
		let retryCnt = 0
		do {
			try {
				const list = await this.getYoutubeTranscriptionsFromYoutubeTranscript(videoId)
				if (list && list.length) {

					const lang = 'en'
					return list.map((tran) => {
						return {
							text: he.decode(tran.subtitle),
							duration: tran.dur,
							offset: tran.start,
							lang: lang,
						}
					})
				}
			} catch (error) {
				console.error(error)
				await sleep(3000)
				retryCnt++
			}
		} while (retryCnt < 2)
		return null

	}

	async callClaude(captions: YoutubeCaptionModel[]) {
		let retryCnt = 0
		do {
			const result = await this.getClaudeTimestamp(captions)
			if (result)	{
				return result
			}
			retryCnt++
		} while (retryCnt < this.MAX_RETRY_CNT)
		return null
	}

	private async getYoutubeTranscriptionsFromYoutubeTranscript(videoId: string) {
		const transcript = await YoutubeTranscript.fetchTranscript(videoId)
		return transcript.map((tr) => {
			return {
				subtitle: tr.text,
				start: tr.offset,
				dur: tr.duration,
			}
		})
	}

	private async getClaudeTimestamp(captions: YoutubeCaptionModel[]) {
		try {
			const key = this.configService.get('CLAUDE_API_KEY')
			const anthropic = new Anthropic({
				apiKey: key,
			})
			const message = await anthropic.messages.create({
				model: 'claude-3-5-sonnet-20240620', // 'claude-3-opus-20240229', // 'claude-3-5-sonnet-20240620',
				max_tokens: this.MAX_TOKENS,
				temperature: this.TEMPERATURE / 2,
				messages: [
					{
						'role': 'user',
						'content': '유튜브 자막을 가지고 번역해서 보여주고싶어',
					},
					{
						'role': 'assistant',
						'content': `
					Youtube 영어 자막을 가지고 한글 번역을 생성할겁니다.
					{"text": string, "duration": number, "offset": number}[] 형식의 JSON 배열로 YouTube 자막을 전달해주면,
					text를 읽어서 korean 필드에 번역한 문장을 넣도록 하겠습니다.

					응답값은 다음 형식으로 전달합니다:
					{ "data": [ { "text": string, "duration": number, "offset": number, "korean": string } ] }

					예시:
					{ "data": [ { "text": 'i am a boy', "duration": 10, "offset": 0, "korean": '나는 소년이야' } ] }

					데이터 작성 시 주의할 점은 아래와 같습니다:
					- 영어가 소리를 기반으로한 자동생성 자막이다보니 오타가 있을수 있습니다. 문맥상 맞지 않는 부분은 수정해주세요.
					`,
				  },
				  {
						'role': 'user',
						'content': `
					응답은 { "data": [ { "text": string, "duration": number,
					"offset": number, "korean": string } ] } 형식으로 해주세요. 앞뒤로 다른 말을 덧붙이지 말고 전달해 주세요.

					여기에 자막이 JSON 형식으로 제공됩니다:
					${JSON.stringify(captions)}
					`,
				  },
				],
			})
			console.log('claude')
			console.log(message.usage)
			console.log(message.content[0])
		  if ('text' in message.content[0]) {
				const parsedResponse: { data: YoutubeCaptionKoreanModel[] } = JSON.parse(message.content[0].text)
				return parsedResponse.data
		  }
		  return null
		} catch (error) {
			console.error(error)
			return null
		}

	}
}

export interface YoutubeCaptionModel {
	text: string;
	duration: number;
	offset: number;
}

export interface YoutubeCaptionKoreanModel {
	text: string;
	duration: number;
	offset: number;
	korean: string;
}
