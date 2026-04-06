import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const finetune = new Hono<{ Bindings: Bindings }>()

// ─────────────────────────────────────────────
// LoRAファインチューニング用データセットをJSONL形式でエクスポート
// GET /api/finetune/export/:characterId
// ─────────────────────────────────────────────
finetune.get('/export/:characterId', async (c) => {
  const characterId = c.req.param('characterId')

  const character: any = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE id = ?'
  ).bind(characterId).first()

  if (!character) {
    return c.json({ success: false, error: 'キャラクターが見つかりません' }, 404)
  }

  const { results: memories } = await c.env.DB.prepare(
    'SELECT * FROM memories WHERE character_id = ? ORDER BY period ASC'
  ).bind(characterId).all()

  const { results: conversations } = await c.env.DB.prepare(
    `SELECT c1.content as user_msg, c2.content as assistant_msg
     FROM conversations c1
     JOIN conversations c2 ON c1.character_id = c2.character_id
       AND c2.created_at > c1.created_at
       AND c1.role = 'user' AND c2.role = 'assistant'
     WHERE c1.character_id = ?
     ORDER BY c1.created_at ASC`
  ).bind(characterId).all()

  const systemPrompt = `あなたは${character.name}（${character.age || ''}歳、${character.birthplace || ''}出身）です。
${character.description || ''}
記憶と経験に基づいて、その人物として温かく自然に話してください。`

  // JSONL形式のデータセット生成
  const lines: string[] = []

  // 記憶からの自己紹介エントリ
  for (const memory of memories as any[]) {
    const entry = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${memory.title}について教えてください` },
        {
          role: 'assistant',
          content: `${memory.period ? `${memory.period}のことですね。` : ''}${memory.content}${memory.emotion ? `あの頃は本当に${memory.emotion}気持ちでした。` : ''}`,
        },
      ]
    }
    lines.push(JSON.stringify(entry))
  }

  // 会話履歴からのエントリ
  for (const conv of conversations as any[]) {
    const entry = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: (conv as any).user_msg },
        { role: 'assistant', content: (conv as any).assistant_msg },
      ]
    }
    lines.push(JSON.stringify(entry))
  }

  const jsonlContent = lines.join('\n')

  // ファイルとしてダウンロード
  return new Response(jsonlContent, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': `attachment; filename="finetune_${character.name}_${Date.now()}.jsonl"`,
    }
  })
})

// ─────────────────────────────────────────────
// LoRA学習設定をPythonスクリプト形式でエクスポート
// GET /api/finetune/script/:characterId
// ─────────────────────────────────────────────
finetune.get('/script/:characterId', async (c) => {
  const characterId = c.req.param('characterId')
  const character: any = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE id = ?'
  ).bind(characterId).first()

  if (!character) {
    return c.json({ success: false, error: 'キャラクターが見つかりません' }, 404)
  }

  const script = `#!/usr/bin/env python3
# ============================================================
# 記憶の声 - LoRAファインチューニングスクリプト
# キャラクター: ${character.name}
# 生成日時: ${new Date().toISOString()}
# ============================================================
# 必要パッケージ:
#   pip install transformers peft trl datasets accelerate bitsandbytes
# ============================================================

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model, TaskType
from trl import SFTTrainer, SFTConfig
from datasets import load_dataset

# ── 設定 ─────────────────────────────────────────────────────
MODEL_ID = "google/gemma-4-26b-a4b-it"   # Gemma 4 26B MoE (推奨)
# MODEL_ID = "google/gemma-4-e4b-it"     # 軽量版 (VRAM少ない場合)
DATASET_PATH = "finetune_${character.name.replace(/\s+/g, '_')}.jsonl"
OUTPUT_DIR = "./lora_adapter_${character.name.replace(/\s+/g, '_')}"
CHARACTER_NAME = "${character.name}"

# ── 量子化設定 (QLoRA) ──────────────────────────────────────
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_use_double_quant=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
)

# ── モデル・トークナイザー読み込み ───────────────────────────
print(f"モデル読み込み中: {MODEL_ID}")
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
tokenizer.pad_token = tokenizer.eos_token

model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    quantization_config=bnb_config,
    device_map="auto",
    torch_dtype=torch.bfloat16,
)

# ── LoRA設定 ─────────────────────────────────────────────────
lora_config = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=16,                          # ランク (記憶量↑ならr=32〜64)
    lora_alpha=32,                 # スケーリング係数
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    lora_dropout=0.05,
    bias="none",
)

model = get_peft_model(model, lora_config)
model.print_trainable_parameters()

# ── データセット読み込み ─────────────────────────────────────
dataset = load_dataset("json", data_files=DATASET_PATH, split="train")
print(f"データセット: {len(dataset)}件")

def format_messages(example):
    """チャットテンプレートを適用"""
    return tokenizer.apply_chat_template(
        example["messages"],
        tokenize=False,
        add_generation_prompt=False,
    )

# ── 学習設定 ─────────────────────────────────────────────────
training_args = SFTConfig(
    output_dir=OUTPUT_DIR,
    num_train_epochs=3,
    per_device_train_batch_size=2,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    lr_scheduler_type="cosine",
    warmup_ratio=0.05,
    bf16=True,
    logging_steps=10,
    save_steps=100,
    save_total_limit=2,
    report_to="none",
    max_seq_length=2048,
    packing=True,
)

# ── 学習実行 ─────────────────────────────────────────────────
trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    args=training_args,
    train_dataset=dataset,
    formatting_func=format_messages,
)

print(f"\\n{'='*50}")
print(f"キャラクター '{CHARACTER_NAME}' のLoRAファインチューニング開始")
print(f"{'='*50}\\n")

trainer.train()
trainer.save_model(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)

print(f"\\n✅ 完了! アダプタを保存しました: {OUTPUT_DIR}")
print("\\n推論コマンド例:")
print(f"  python inference.py --adapter {OUTPUT_DIR} --character '{CHARACTER_NAME}'")
`

  return new Response(script, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="train_${character.name.replace(/\s+/g, '_')}.py"`,
    }
  })
})

// ─────────────────────────────────────────────
// 推論スクリプト生成
// GET /api/finetune/inference-script/:characterId
// ─────────────────────────────────────────────
finetune.get('/inference-script/:characterId', async (c) => {
  const characterId = c.req.param('characterId')
  const character: any = await c.env.DB.prepare(
    'SELECT * FROM characters WHERE id = ?'
  ).bind(characterId).first()

  if (!character) {
    return c.json({ success: false, error: 'キャラクターが見つかりません' }, 404)
  }

  const script = `#!/usr/bin/env python3
# ============================================================
# 記憶の声 - 推論スクリプト
# キャラクター: ${character.name}
# ============================================================

import argparse
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

def load_model(base_model_id: str, adapter_path: str):
    tokenizer = AutoTokenizer.from_pretrained(base_model_id)
    base_model = AutoModelForCausalLM.from_pretrained(
        base_model_id,
        torch_dtype=torch.bfloat16,
        device_map="auto",
    )
    model = PeftModel.from_pretrained(base_model, adapter_path)
    model.eval()
    return model, tokenizer

def chat(model, tokenizer, system_prompt: str, message: str, history: list):
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": message})

    text = tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    inputs = tokenizer(text, return_tensors="pt").to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=256,
            temperature=0.8,
            top_p=0.95,
            do_sample=True,
            repetition_penalty=1.1,
        )

    response = tokenizer.decode(
        outputs[0][inputs["input_ids"].shape[-1]:],
        skip_special_tokens=True
    )
    return response.strip()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base_model", default="google/gemma-4-26b-a4b-it")
    parser.add_argument("--adapter", required=True)
    args = parser.parse_args()

    system_prompt = """あなたは${character.name}（${character.age || ''}歳）です。
${character.description || ''}
温かく穏やかに、記憶に基づいて話してください。"""

    print(f"モデル読み込み中...")
    model, tokenizer = load_model(args.base_model, args.adapter)
    print(f"\\n${character.name}との会話を開始します（Ctrl+Cで終了）\\n")

    history = []
    while True:
        try:
            user_input = input("あなた: ").strip()
            if not user_input:
                continue
            response = chat(model, tokenizer, system_prompt, user_input, history)
            print(f"${character.name}: {response}\\n")
            history.append({"role": "user", "content": user_input})
            history.append({"role": "assistant", "content": response})
            if len(history) > 20:
                history = history[-20:]
        except KeyboardInterrupt:
            print("\\n会話を終了します。")
            break
`

  return new Response(script, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="inference_${character.name.replace(/\s+/g, '_')}.py"`,
    }
  })
})

export default finetune
