with open('templates/index.html', encoding='utf-8') as f:
    for i, line in enumerate(f):
        if 'id="view-' in line or 'data-target="view-' in line:
            print(f"{i+1}: {line.strip()}")
