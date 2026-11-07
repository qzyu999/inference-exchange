// Keep iteration outside the catch so a failed stream cannot start a second request.
export function pythonFallbackExample(stream, notes) {
  return `import os
from openai import OpenAI, APIStatusError

client = OpenAI(
    api_key=os.environ["IE_API_KEY"],
    base_url="https://alpha.inferenceex.com/v1",
    max_retries=0,
)
openrouter = OpenAI(
    api_key=os.environ["OPENROUTER_API_KEY"],
    base_url="https://openrouter.ai/api/v1",
    max_retries=0,
)
model = os.environ["IE_MODEL"]
messages = [{"role": "user", "content": "Say hello."}]

${notes.map(note => '# ' + note).join('\n')}
minimum = "open"
# This example permits a different free model on OpenRouter.
# OpenRouter receives the prompt. Its providers have their own data policies.
try:
    result = client.chat.completions.create(
        model=model,
        messages=messages,
        stream=${stream ? 'True' : 'False'},
        extra_body={"ocip_min_confidence": minimum},
    )
except APIStatusError as exc:
    if (exc.status_code != 503 or exc.code != "model_not_available"
            or minimum.strip().lower() not in ("open", "l0")):
        raise
    result = openrouter.chat.completions.create(
        model="openrouter/free",
        messages=messages,
        stream=${stream ? 'True' : 'False'},
    )

${stream ? `for chunk in result:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()` : 'print(result.choices[0].message.content)'}
`
}

export function nodeFallbackExample(stream, notes) {
  return `import OpenAI from "openai";

const { IE_API_KEY, OPENROUTER_API_KEY, IE_MODEL } = process.env;
if (!IE_API_KEY || !OPENROUTER_API_KEY || !IE_MODEL) {
  throw new Error("Set IE_API_KEY, OPENROUTER_API_KEY, and IE_MODEL first");
}
const client = new OpenAI({
  apiKey: IE_API_KEY,
  baseURL: "https://alpha.inferenceex.com/v1",
  maxRetries: 0,
});
const openrouter = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  maxRetries: 0,
});

${notes.map(note => '// ' + note).join('\n')}
const minimum = "open";
// This example permits a different free model on OpenRouter.
// OpenRouter receives the prompt. Its providers have their own data policies.
let result;
try {
  result = await client.chat.completions.create({
    model: IE_MODEL,
    messages: [{ role: "user", content: "Say hello." }],
    stream: ${stream},
    ocip_min_confidence: minimum,
  });
} catch (error) {
  if (!(error instanceof OpenAI.APIError) || error.status !== 503 ||
      error.code !== "model_not_available" ||
      !["open", "l0"].includes(minimum.trim().toLowerCase())) {
    throw error;
  }
  result = await openrouter.chat.completions.create({
    model: "openrouter/free",
    messages: [{ role: "user", content: "Say hello." }],
    stream: ${stream},
  });
}

${stream ? `for await (const chunk of result) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
process.stdout.write("\\n");` : 'console.log(result.choices[0].message.content);'}
`
}
