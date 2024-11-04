import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
const client = new SecretsManagerClient({ region: 'ap-northeast-2' })

export class SecretManager {
	async getEnv(): Promise<Record<string, any>> {
		try {
			const params = {
				SecretId: 'prod/yt-translation/env',
			}
			const command = new GetSecretValueCommand(params)
			const data = await client.send(command)
			const secret = data.SecretString
			if (secret) {
				const parseSecret = JSON.parse(secret)
				console.info(parseSecret)
				return {
					...parseSecret,
					NODE_ENV: process.env.NODE_ENV || 'development',
				}
			} else {
				return {
					NODE_ENV: process.env.NODE_ENV || 'development',
				}
			}
		} catch (error) {
			console.error('SecretManager.getEnv')
			console.error(error)
			return {}
		}

	}
}
