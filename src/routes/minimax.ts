import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
  MINIMAX_API_KEY: string
}

const minimax = new Hono<{ Bindings: Bindings }>()

const MINIMAX_BASE_URL = 'https://api.minimax.io/v1'
const GROUP_ID = 'kioku-no-koe'

// ── ヘルパー: MiniMax APIキー取得 ───────────────────────────────
function getApiKey(c: any): string {
  return c.env?.MINIMAX_API_KEY || ''
}

// ─────────────────────────────────────────────
// TTS: テキスト → 音声
// POST /api/minimax/tts
// body: { text, voice_id?, speed?, vol?, pitch?, emotion? }
// ─────────────────────────────────────────────
minimax.post('/tts', async (c) => {
  const apiKey = getApiKey(c)
  if (!apiKey) return c.json({ success: false, error: 'APIキーが設定されていません' }, 500)

  const body = await c.req.json()
  const {
    text,
    voice_id = 'Wise_Woman',
    speed = 0.9,
    vol = 1.0,
    pitch = 0,
    emotion = 'neutral',
  } = body

  if (!text) return c.json({ success: false, error: 'text は必須です' }, 400)

  try {
    const response = await fetch(`${MINIMAX_BASE_URL}/t2a_v2`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'speech-2.8-turbo',
        text,
        stream: false,
        voice_setting: {
          voice_id,
          speed,
          vol,
          pitch,
          emotion,
          latex_read: false,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('MiniMax TTS error:', err)
      return c.json({ success: false, error: `MiniMax APIエラー: ${response.status}` }, 500)
    }

    const data: any = await response.json()

    if (data.base_resp?.status_code !== 0) {
      return c.json({
        success: false,
        error: data.base_resp?.status_msg || 'TTS生成失敗'
      }, 500)
    }

    // audio_file は base64エンコードされたmp3
    return c.json({
      success: true,
      data: {
        audio_hex: data.data?.audio,
        format: 'mp3',
        sample_rate: 32000,
      }
    })
  } catch (e: any) {
    console.error('TTS fetch error:', e)
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// ボイスクローン: 音声ファイルURL → カスタムボイスID
// POST /api/minimax/voice-clone
// body: { character_id, audio_url, voice_name }
// ─────────────────────────────────────────────
minimax.post('/voice-clone', async (c) => {
  const apiKey = getApiKey(c)
  if (!apiKey) return c.json({ success: false, error: 'APIキーが設定されていません' }, 500)

  const body = await c.req.json()
  const { character_id, audio_url, voice_name } = body

  if (!character_id || !audio_url || !voice_name) {
    return c.json({ success: false, error: 'character_id, audio_url, voice_name は必須です' }, 400)
  }

  // ジョブ登録
  const jobResult = await c.env.DB.prepare(
    `INSERT INTO voice_clone_jobs (character_id, status) VALUES (?, 'processing')`
  ).bind(character_id).run()
  const jobId = jobResult.meta.last_row_id

  try {
    // Step1: MiniMax Voice Cloning API
    const cloneResponse = await fetch(`${MINIMAX_BASE_URL}/voice_clone`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_url: audio_url,
        voice_id: `clone_${character_id}_${Date.now()}`,
        text: `私の名前は${voice_name}です。よろしくお願いいたします。`,
      }),
    })

    const cloneData: any = await cloneResponse.json()

    if (!cloneResponse.ok || cloneData.base_resp?.status_code !== 0) {
      const errMsg = cloneData.base_resp?.status_msg || 'ボイスクローン失敗'
      await c.env.DB.prepare(
        `UPDATE voice_clone_jobs SET status='error', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(errMsg, jobId).run()
      return c.json({ success: false, error: errMsg }, 500)
    }

    const newVoiceId = cloneData.voice_id || cloneData.data?.voice_id

    // キャラクターにvoice_idを保存
    await c.env.DB.prepare(
      `UPDATE characters SET voice_id=?, voice_sample_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(newVoiceId, audio_url, character_id).run()

    await c.env.DB.prepare(
      `UPDATE voice_clone_jobs SET status='done', minimax_voice_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(newVoiceId, jobId).run()

    return c.json({
      success: true,
      data: {
        voice_id: newVoiceId,
        job_id: jobId,
        message: 'ボイスクローンが完了しました',
      }
    })
  } catch (e: any) {
    await c.env.DB.prepare(
      `UPDATE voice_clone_jobs SET status='error', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(e.message, jobId).run()
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// ボイスクローン: フォームからバイナリ音声を直接送信
// POST /api/minimax/voice-clone-upload
// multipart form: audio_file (Blob), character_id, voice_name
// ─────────────────────────────────────────────
minimax.post('/voice-clone-upload', async (c) => {
  const apiKey = getApiKey(c)
  if (!apiKey) return c.json({ success: false, error: 'APIキーが設定されていません' }, 500)

  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return c.json({ success: false, error: 'multipart/form-data で送信してください' }, 400)
  }

  const audioFile = formData.get('audio_file') as File | null
  const characterId = formData.get('character_id') as string
  const voiceName = formData.get('voice_name') as string

  if (!audioFile || !characterId || !voiceName) {
    return c.json({ success: false, error: 'audio_file, character_id, voice_name は必須です' }, 400)
  }

  // ジョブ登録
  const jobResult = await c.env.DB.prepare(
    `INSERT INTO voice_clone_jobs (character_id, status) VALUES (?, 'processing')`
  ).bind(characterId).run()
  const jobId = jobResult.meta.last_row_id

  try {
    // Step1: MiniMax Files API でファイルをアップロード
    const uploadForm = new FormData()
    uploadForm.append('file', audioFile, audioFile.name || 'voice_sample.mp3')
    uploadForm.append('purpose', 'voice_clone')

    const uploadResponse = await fetch(`${MINIMAX_BASE_URL}/files/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: uploadForm,
    })

    const uploadData: any = await uploadResponse.json()
    if (!uploadResponse.ok || uploadData.base_resp?.status_code !== 0) {
      const errMsg = uploadData.base_resp?.status_msg || 'ファイルアップロード失敗'
      await c.env.DB.prepare(
        `UPDATE voice_clone_jobs SET status='error', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(errMsg, jobId).run()
      return c.json({ success: false, error: errMsg }, 500)
    }

    const fileId = uploadData.file?.file_id

    // Step2: ボイスクローン実行
    const voiceId = `clone_${characterId}_${Date.now()}`
    const cloneResponse = await fetch(`${MINIMAX_BASE_URL}/voice_clone`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_id: fileId,
        voice_id: voiceId,
        text: `はじめまして。私の名前は${voiceName}と申します。どうぞよろしくお願いいたします。`,
      }),
    })

    const cloneData: any = await cloneResponse.json()
    if (!cloneResponse.ok || cloneData.base_resp?.status_code !== 0) {
      const errMsg = cloneData.base_resp?.status_msg || 'ボイスクローン失敗'
      await c.env.DB.prepare(
        `UPDATE voice_clone_jobs SET status='error', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(errMsg, jobId).run()
      return c.json({ success: false, error: errMsg }, 500)
    }

    const newVoiceId = cloneData.voice_id || cloneData.data?.voice_id || voiceId

    await c.env.DB.prepare(
      `UPDATE characters SET voice_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(newVoiceId, characterId).run()

    await c.env.DB.prepare(
      `UPDATE voice_clone_jobs SET status='done', minimax_voice_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(newVoiceId, jobId).run()

    return c.json({
      success: true,
      data: { voice_id: newVoiceId, job_id: jobId, message: 'ボイスクローンが完了しました' }
    })
  } catch (e: any) {
    await c.env.DB.prepare(
      `UPDATE voice_clone_jobs SET status='error', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(e.message, jobId).run()
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─────────────────────────────────────────────
// 利用可能なプリセットボイス一覧
// GET /api/minimax/voices
// ─────────────────────────────────────────────
minimax.get('/voices', async (c) => {
  // MiniMax 標準ボイス一覧（日本語対応）
  const presetVoices = [
    { id: 'Wise_Woman', name: '知恵ある女性', lang: 'ja', gender: 'female' },
    { id: 'Gentle_Man', name: '穏やかな男性', lang: 'ja', gender: 'male' },
    { id: 'Warm_Woman', name: '温かな女性', lang: 'ja', gender: 'female' },
    { id: 'Deep_Voice_Man', name: '渋い男性', lang: 'ja', gender: 'male' },
    { id: 'Caring_Lady', name: '優しい女性', lang: 'ja', gender: 'female' },
    { id: 'Friendly_Person', name: '親しみやすい', lang: 'ja', gender: 'neutral' },
    { id: 'Narrator', name: 'ナレーター', lang: 'ja', gender: 'neutral' },
  ]

  // DBに保存済みのクローンボイスも返す
  const { results: clonedVoices } = await c.env.DB.prepare(
    `SELECT c.id as character_id, c.name as character_name, c.voice_id
     FROM characters c WHERE c.voice_id IS NOT NULL`
  ).all()

  return c.json({
    success: true,
    data: {
      preset: presetVoices,
      cloned: clonedVoices,
    }
  })
})

// ─────────────────────────────────────────────
// ジョブステータス確認
// GET /api/minimax/job/:jobId
// ─────────────────────────────────────────────
minimax.get('/job/:jobId', async (c) => {
  const jobId = c.req.param('jobId')
  const job = await c.env.DB.prepare(
    'SELECT * FROM voice_clone_jobs WHERE id = ?'
  ).bind(jobId).first()

  if (!job) return c.json({ success: false, error: 'ジョブが見つかりません' }, 404)
  return c.json({ success: true, data: job })
})

export default minimax
