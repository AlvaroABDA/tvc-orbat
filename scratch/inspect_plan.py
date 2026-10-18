import json

with open(r'C:\Users\Velha\.gemini\antigravity-ide\brain\44bf005c-3a79-4825-8636-4b2491b4b894\.system_generated\logs\transcript.jsonl', 'r', encoding='utf-8') as f:
    for i, line in enumerate(f):
        if i in (885, 886, 905):
            obj = json.loads(line)
            print(f"=== STEP {i} ({obj.get('type')}) ===")
            content = obj.get('content', '')
            print(content[:1500] if content else 'No content')
