import { Injectable, Logger } from '@nestjs/common'
import * as fs from 'fs'
import { SpeechClient } from '@google-cloud/speech'
import { Translate } from '@google-cloud/translate/build/src/v2'
import youtubeDl from 'youtube-dl-exec'
import * as path from 'path'
import key from '../youtube-key.json'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

interface TranscriptionSentence {
	startTime: number;
	endTime: number;
	text: string;
	translatedText?: string;
	speakerId: number;
}

@Injectable()
export class STTService {
	private readonly logger = new Logger(STTService.name)
	private speechClient: SpeechClient
	private translateClient: Translate

	constructor() {
		this.speechClient = new SpeechClient({ credentials: key })
		this.translateClient = new Translate({ credentials: key })
		if (ffmpegStatic) {
			ffmpeg.setFfmpegPath(ffmpegStatic)
			// ffmpeg.setFfprobePath(ffprobeStatic.path)
		}
		if (ffprobeStatic.path) {
			ffmpeg.setFfprobePath(ffprobeStatic.path)
		}
		this.logFFmpegVersion()
	}

	private async logFFmpegVersion() {
		return new Promise<void>((resolve) => {
		  ffmpeg.ffprobe('-version', (err, data) => {
				if (err) {
					console.error('Error getting FFmpeg version:', err)
				} else {
					console.log('FFmpeg version:', data)
				}
				resolve()
		  })
		})
	  }

	  async processYouTubeVideo(videoUrl: string): Promise<TranscriptionSentence[]> {
		console.log(videoUrl)

		const audioFilePath = 'audio/temp_audio.webm'
		// await this.extractAudioFromYouTube(videoUrl, audioFilePath)
		const chunks = await this.splitAudioFileWithOverlap(audioFilePath, 60, 5)
		const transcription = await this.transcribeChunks(chunks)
		const translatedTranscription = await Promise.all(transcription.map(async (sentence) => {
			const translatedText = await this.translateText(sentence.text)
			return {
				...sentence,
				translatedText,
			}
		}))
		// fs.unlinkSync(audioFilePath)
		// chunks.forEach(chunk => fs.unlinkSync(chunk))
		const jsonFilePath = await this.saveTranscriptionToJson(translatedTranscription, videoUrl)
		return translatedTranscription
	}

	private extractVideoId(url: string): string {
		const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/
		const match = url.match(regex)
		return match ? match[1] : 'unknown'
	}

	private async saveTranscriptionToJson(transcription: TranscriptionSentence[], videoUrl: string): Promise<string> {
		const videoId = this.extractVideoId(videoUrl)
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
		const fileName = `transcription_${videoId}_${timestamp}.json`
		const filePath = path.join(process.cwd(), 'transcriptions', fileName)

		// 디렉토리가 없으면 생성
		const dir = path.dirname(filePath)
		if (!fs.existsSync(dir)) {
		  fs.mkdirSync(dir, { recursive: true })
		}

		const jsonContent = JSON.stringify({
		  videoUrl: videoUrl,
		  transcription: transcription,
		}, null, 2) // 들여쓰기를 위해 2 spaces 사용

		fs.writeFileSync(filePath, jsonContent, 'utf8')
		this.logger.log(`Transcription saved to ${filePath}`)

		return filePath
	  }

	private async getAudioDuration(filePath: string): Promise<number> {
		return new Promise((resolve, reject) => {
		  ffmpeg.ffprobe(filePath, (err, metadata) => {
				if (err) {
			  reject(err)
				} else {
					resolve(metadata.format.duration ?? 0)
				}
			})
		})
	}

	private async extractAudioFromYouTube(videoUrl: string, outputPath: string): Promise<string> {
		await youtubeDl(videoUrl, {
			extractAudio: true,
			audioFormat: 'best',
			output: outputPath,
		})

		// 다운로드된 파일의 실제 이름 찾기
		const files = fs.readdirSync('audio')
		const downloadedFile = files.find(file => file.startsWith('temp_audio.'))

		if (!downloadedFile) {
		  throw new Error('Downloaded audio file not found')
		}

		return downloadedFile
	}

	private async splitAudioFileWithOverlap(filePath: string, chunkDuration: number, overlapDuration: number): Promise<string[]> {
		this.logger.debug(`Splitting audio file: ${filePath}`)
		const outputDir = path.dirname(filePath)
		const baseName = path.basename(filePath, path.extname(filePath))

		try {
		  const duration = await this.getAudioDuration(filePath)
		  this.logger.debug(`Audio duration: ${duration} seconds`)
		  return this.splitAudioWithDuration(filePath, duration, chunkDuration, overlapDuration, outputDir, baseName)
		} catch (error) {
		  this.logger.error('Error getting audio duration:', error)
		  return this.splitAudioWithoutDuration(filePath, chunkDuration, overlapDuration, outputDir, baseName)
		}
	}

	private async splitAudioWithDuration(
		filePath: string,
		duration: number,
		chunkDuration: number,
		overlapDuration: number,
		outputDir: string,
		baseName: string
	  ): Promise<string[]> {
		const chunks: string[] = []
		const numChunks = Math.ceil(duration / (chunkDuration - overlapDuration))
		this.logger.debug(`Splitting into ${numChunks} chunks`)

		for (let i = 0; i < numChunks; i++) {
		  const start = Math.max(0, i * (chunkDuration - overlapDuration))
		  const output = `${outputDir}/${baseName}_${i.toString().padStart(3, '0')}.webm`

		  this.logger.debug(`Processing chunk ${i + 1}/${numChunks}: ${output}`)
		  try {
				await this.processChunk(filePath, start, chunkDuration, output)
				chunks.push(output)
				this.logger.debug(`Chunk ${i + 1}/${numChunks} processed successfully`)
		  } catch (error) {
				this.logger.error(`Error processing chunk ${i + 1}/${numChunks}:`, error)
				break  // Stop processing if an error occurs
		  }
		}

		return chunks
	  }

	  private async splitAudioWithoutDuration(
		filePath: string,
		chunkDuration: number,
		overlapDuration: number,
		outputDir: string,
		baseName: string
	  ): Promise<string[]> {
		const chunks: string[] = []
		let chunkIndex = 0
		const maxChunks = 15 // 안전장치: 최대 청크 수 제한

		this.logger.debug(`Splitting audio without known duration, max chunks: ${maxChunks}`)

		while (chunkIndex < maxChunks) {
		  const start = chunkIndex * (chunkDuration - overlapDuration)
		  const output = `${outputDir}/${baseName}_${chunkIndex.toString().padStart(3, '0')}.webm`

		  this.logger.debug(`Processing chunk ${chunkIndex + 1}: ${output}`)
		  try {
				await this.processChunk(filePath, start, chunkDuration, output)
				const stats = fs.statSync(output)
				if (stats.size === 0) {
			  this.logger.debug('Empty file detected. Assuming end of audio.')
			  fs.unlinkSync(output)  // Remove empty file
			  break
				}
				chunks.push(output)
				chunkIndex++
		  } catch (error) {
				if (error instanceof Error && error.message.includes('End of file')) {
			  this.logger.debug('Reached end of file. Processing completed.')
			  break
				}
				this.logger.error(`Error processing chunk ${chunkIndex + 1}:`, error)
				break  // Stop processing if an error occurs
		  }
		}

		this.logger.debug(`Finished splitting audio, total chunks: ${chunks.length}`)
		return chunks
	  }

	  private async processChunk(filePath: string, start: number, duration: number, output: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
		  ffmpeg(filePath)
				.setStartTime(start)
				.setDuration(duration)
				.output(output)
				.on('end', () => {
			  this.logger.debug('FFmpeg process completed')
			  resolve()
				})
				.on('error', (err: Error) => {
			  if (err.message.includes('End of file') || err.message.includes('Invalid data found when processing input')) {
						this.logger.debug('Treating as end of file')
						resolve()
			  } else {
						this.logger.error('FFmpeg process error:', err)
						reject(err)
			  }
				})
				.run()
		})
	  }

	  private async transcribeChunks(chunks: string[]): Promise<TranscriptionSentence[]> {
		let allSentences: TranscriptionSentence[] = []
		for (let i = 0; i < chunks.length; i++) {
			const chunkPath = chunks[i]
			const chunkStartTime = i * 55 // 60초 청크에 5초 오버랩
			const chunkSentences = await this.transcribeChunk(chunkPath, chunkStartTime)
			allSentences = allSentences.concat(chunkSentences)
		}
		return this.mergeSentences(allSentences)
	  }

	  private async transcribeChunk(chunkPath: string, chunkStartTime: number): Promise<TranscriptionSentence[]> {
		const file = fs.readFileSync(chunkPath)
		const audioBytes = file.toString('base64')

		const audio = {
		  content: audioBytes,
		}
		const config = {
		  encoding: 'WEBM_OPUS' as const,
		  sampleRateHertz: 48000,
		  audioChannelCount: 2,  // 스테레오로 설정
		  languageCode: 'en-US',
		  enableWordTimeOffsets: true,
		  enableAutomaticPunctuation: true,
		  diarizationSpeakerCount: 1,
		  model: 'latest_long',  // 긴 오디오에 적합한 모델
		}

		const request = {
		  audio: audio,
		  config: config,
		}

		const [ response ] = await this.speechClient.recognize(request)
		const sentences: TranscriptionSentence[] = []
		let currentSentence: TranscriptionSentence | null = null
		const maxSentenceDuration = 10 // 최대 문장 길이를 10초로 설정

		const diarizationResult = response.results?.pop()
		if (diarizationResult?.alternatives?.[0]?.words) {
			const words = diarizationResult.alternatives[0].words

			words.forEach((wordInfo, index) => {
				const startSecs = Number(wordInfo.startTime?.seconds) || 0
				const startNanos = Number(wordInfo.startTime?.nanos) || 0
				const endSecs = Number(wordInfo.endTime?.seconds) || 0
				const endNanos = Number(wordInfo.endTime?.nanos) || 0

				const wordStartTime = chunkStartTime + startSecs + startNanos / 1e9
				const wordEndTime = chunkStartTime + endSecs + endNanos / 1e9
				const speakerId = Number(wordInfo.speakerTag) || 0

				if (!currentSentence || currentSentence.speakerId !== speakerId) {
					if (currentSentence) {
						sentences.push(currentSentence)
					}
					currentSentence = {
						startTime: wordStartTime,
						endTime: wordEndTime,
						text: wordInfo.word || '',
						speakerId: speakerId,
					}
				} else {
					currentSentence.endTime = wordEndTime
					currentSentence.text += ' ' + (wordInfo.word || '')
				}

				const shouldSplitSentence =
          wordInfo.word?.match(/[.!?]$/) ||
          (currentSentence.endTime - currentSentence.startTime) > maxSentenceDuration ||
          (index > 0 && (wordStartTime - currentSentence.endTime) > 1)

				if (shouldSplitSentence) {
					sentences.push(currentSentence)
					currentSentence = null
				}
			})
		}

		if (currentSentence) {
			sentences.push(currentSentence)
		}

		return sentences
	  }

	  private mergeSentences(sentences: TranscriptionSentence[]): TranscriptionSentence[] {
		const mergedSentences: TranscriptionSentence[] = []
		let currentSentence: TranscriptionSentence | null = null
		const maxMergedSentenceDuration = 10 // 최대 병합된 문장 길이를 10초로 설정

		for (const sentence of sentences) {
		  if (!currentSentence || currentSentence.speakerId !== sentence.speakerId) {
				if (currentSentence) {
			  mergedSentences.push(currentSentence)
				}
				currentSentence = { ...sentence }
		  } else {
				const mergedDuration = sentence.endTime - currentSentence.startTime
				const timeBetweenSentences = sentence.startTime - currentSentence.endTime

				if (mergedDuration <= maxMergedSentenceDuration && timeBetweenSentences <= 0.5) {
			  currentSentence.endTime = sentence.endTime
			  currentSentence.text += ' ' + sentence.text
				} else {
			  mergedSentences.push(currentSentence)
			  currentSentence = { ...sentence }
				}
		  }
		}

		if (currentSentence) {
		  mergedSentences.push(currentSentence)
		}

		return mergedSentences
	  }

	private async translateText(text: string): Promise<string> {
		const [ translation ] = await this.translateClient.translate(text, 'ko')
		return translation
	}

	private reconstructSentences(text: string): string {
		// 문장 단위로 분리
		const sentences = text.match(/[^.!?]+[.!?]+/g) || []

		// 중복된 문장 제거
		const uniqueSentences = sentences.filter((sentence, index, self) =>
		  index === self.findIndex((t) => t.trim() === sentence.trim())
		)

		return uniqueSentences.join(' ')
	}

}
