# Choosing a coach model

Lactic's coach is optional and bring-your-own: run it on an AI key you already have, on a model on your own computer, or connect an AI app you already use over MCP. This page says which models work well, which to skip, what they cost and what leaves your computer. Checked November 2026; model lineups move fast, so "Test this model" in Settings → Coach is the final word.

## What the coach needs

The coach doesn't guess your numbers. Lactic's engine works out fitness, fatigue, zones and the plan, and the coach looks them up with tools (your plan, rides, recovery, weight) before it answers. So the one thing a model must do well is **call tools reliably and follow instructions**. Raw size and benchmark scores matter less. "Test this model" sends one question that needs a tool and tells you whether the model used it.

## Built-in coach

| Where | Start with | Also good | Rough cost for daily use |
| --- | --- | --- | --- |
| OpenRouter (one key, many models) | Claude Haiku 5.5 `anthropic/claude-haiku-5.5` | Claude Sonnet 5.5 `anthropic/claude-sonnet-5.5`; open models GLM 5.3 `z-ai/glm-5.3`, Kimi K2.6 `moonshotai/kimi-k2.6`, DeepSeek V4.1 Flash `deepseek/deepseek-v4.1-flash` | Haiku, GLM, DeepSeek: under $1 a month. Kimi K2.6: about $3. Sonnet: about $14 |
| Anthropic key | Claude Haiku 5.5 `claude-haiku-5-5` | Claude Sonnet 5.5 `claude-sonnet-5-5` | Under $1 / about $14 |
| OpenAI key | GPT-6 Luna `gpt-6-luna` | GPT-6.1 Terra `gpt-6.1-terra`, GPT-6.1 Sol `gpt-6.1-sol` | Under $1 / about $7 / about $14 |
| Google Gemini key | Gemini 3.8 Flash `gemini-3.8-flash` | Gemini 3.5 Flash-Lite `gemini-3.5-flash-lite` | About $10 / about $2 (AI Studio has a free tier with rate limits) |
| Ollama or LM Studio on this computer | Qwen 3 8B `qwen3:8b` (16 GB Mac) | Qwen 3 14B `qwen3:14b` or gpt-oss 20B `gpt-oss:20b` (24 GB), Qwen 3.8 27B `qwen3.8:27b` (32 GB, the best local coach) | Free |

"Daily use" means about 200 coach turns a month (a chat message, the morning brief, the weekly picks), each reading about 30k tokens across its tool calls and writing about 1k. That's calibrated on real use of the app Lactic grew out of; your bill depends on how much you chat. Settings → Coach shows the estimate next to each suggestion.

If you ride with Zwift open on the same computer, leave some memory for it: on a 16 GB Mac stick to Qwen 3 8B.

## Skip these

- **Models under about 7B parameters** (Llama 3.2 1B/3B, Phi Mini, Gemma 2B). They garble tool calls and make numbers up.
- **Models without tool support.** In Ollama, look for the Tools badge on the model's page.
- **Heavily shrunk downloads** (Q3, Q2, IQ quants). Tool use breaks before chat does; Q4 is the floor.
- **Top-end models** (Claude Opus or Fable, GPT Pro or Astra, Gemini Argon). They cost several times more and a training coach won't notice the difference.

## AI apps over MCP

Choose "An AI app you already use" to let Claude Desktop (or another MCP app) read your training and propose changes that you approve in Lactic. These run on your own subscription, so Lactic's monthly limit doesn't apply. Use a model that's good with tools: Claude Sonnet 5.5 or Opus 5.5 in Claude Desktop, or at least Qwen 3 8B in an app running a model on your computer. ChatGPT only connects to servers on the internet, so it can't reach Lactic yet.

## Monthly limit

For cloud models Lactic adds up what each coach reply costs and pauses the coach for the rest of the month when it reaches your limit (default $10). It uses the provider's price when the provider lists one (OpenRouter does) and Lactic's list price for the suggested models otherwise. Your plan, workouts, rides and the engine's own workout picks carry on; the coach comes back on the 1st, or as soon as you raise the limit or switch to a local model.

This limit lives in Lactic, not with your provider, so also set a spending or credit limit on the key itself (OpenRouter lets you cap each key) as a backstop.

## Privacy

- **Cloud models:** each reply sends the parts of your training the coach looked up (plan, rides, recovery, weight) to the provider you chose. Your API key stays in your computer's keychain and is never shown to the coach. On OpenRouter you can limit routing to providers that don't keep or train on prompts in its privacy settings.
- **Ollama or LM Studio:** everything stays on your computer.
- **MCP apps:** the app you connect sees what its coach looks up, under that app's own privacy terms.
