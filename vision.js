// ใช้ global fetch ของ Node 18+ (ไม่ต้องพึ่ง node-fetch)

const PROMPTS = {
  general: `
You are a game stats OCR assistant.
Extract ONLY these fields from this "General Stats" screenshot.
Return ONLY valid JSON, no explanation, no markdown.

Fields to extract:
- hp (HP)
- patk (PATK)
- matk (MATK)

Return format:
{"hp": number, "patk": number, "matk": number}

If a field is not visible, use null.
Numbers only, no commas, no units.
`,

  quasi: `
You are a game stats OCR assistant.
Extract ONLY these fields from this "Quasi Stats" screenshot.
Return ONLY valid JSON, no explanation, no markdown.

This screen has LEFT and RIGHT columns.

Field mapping (supports 2 language variants):
- "Healing Done" OR "Healing Effect" → healing_done (percentage, remove %)
- "Healing Taken" OR "Healing Received" → healing_taken (percentage, remove %)
- "CRIT" (left column) → crit (number)
- "CRIT DMG" → crit_dmg (percentage, remove %)
- "PDMG" OR "P.DMG BONUS" (LEFT column only) → pdmg (percentage, remove %)
- "MDMG" OR "M.DMG BONUS" (LEFT column only) → mdmg (percentage, remove %)
- "PDMG.R" OR "P.DMG Reduction" (RIGHT column) → pdmg_r (percentage, remove %)
- "MDMG.R" OR "M.DMG Reduction" (RIGHT column) → mdmg_r (percentage, remove %)
- "Ignore PDEF" LEFT column (raw number, NOT percentage) → ignore_pdef
- "Ignore MDEF" LEFT column (raw number, NOT percentage) → ignore_mdef
- 2nd row from bottom LEFT column (may be cropped: "PvE DMG Redu...") → pve_dmg_reduc
- Last row LEFT column (may be cropped: "PvP DMG Redu...") → pvp_dmg_reduc
- 2nd row from bottom RIGHT column (may be cropped: "...E DMG Bonus") → pve_dmg_bonus
- Last row RIGHT column (may be cropped: "...P DMG Bonus") → pvp_dmg_bonus

Return format:
{
  "crit": number,
  "crit_dmg": number,
  "healing_done": number,
  "healing_taken": number,
  "pdmg": number,
  "mdmg": number,
  "pdmg_r": number,
  "mdmg_r": number,
  "ignore_pdef": number,
  "ignore_mdef": number,
  "pve_dmg_reduc": number,
  "pvp_dmg_reduc": number,
  "pve_dmg_bonus": number,
  "pvp_dmg_bonus": number
}

If a field is not visible or label is ambiguous, use null.
Numbers only, no % symbols.
`,

  special: `
You are a game stats OCR assistant.
Extract ONLY these fields from this "Special" screenshot.
Return ONLY valid JSON, no explanation, no markdown.

Field mapping (supports 2 language variants):
- "Equipment PDEF" OR "Equipment P.DEF%" → equip_pdef_pct (percentage, remove %)
- "Equipment MDEF" OR "Equipment M.DEF%" → equip_mdef_pct (percentage, remove %)

Return format:
{"equip_pdef_pct": number, "equip_mdef_pct": number}

If a field is not visible, use null.
Numbers only, no % symbols.
`,

  notice: `
You are a game stats OCR assistant.
Extract ONLY these fields from this "Notice" popup screenshot.
Return ONLY valid JSON, no explanation, no markdown.

Fields to extract:
- "Base PDEF" → base_pdef (number after the colon)
- "Equipment PDEF" → equip_pdef (number after the colon)

Return format:
{"base_pdef": number, "equip_pdef": number}

If a field is not visible, use null.
Numbers only, no units.
`
};

async function downloadAsDataUrl(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Discord image download failed: ${res.status} ${res.statusText} (${imageUrl.split('?')[0]})`);
  }
  const type = (res.headers.get('content-type') || 'image/png').split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`[vision] downloaded ${buf.length} bytes (${type})`);
  return `data:${type};base64,${buf.toString('base64')}`;
}

async function analyzeImage(imageUrl, imageType) {
  const prompt = PROMPTS[imageType];
  if (!prompt) throw new Error(`Unknown image type: ${imageType}`);
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');

  console.log(`[vision] analyzing type=${imageType}`);
  const dataUrl = await downloadAsDataUrl(imageUrl);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const raw = (data.choices?.[0]?.message?.content || '').trim();
  console.log(`[vision] raw response (${imageType}): ${raw}`);

  // ลบ markdown code block ถ้ามี
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`JSON parse failed: ${cleaned}`);
  }
}

module.exports = { analyzeImage };