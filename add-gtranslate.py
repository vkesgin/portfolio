import os
import glob

html_files = glob.glob("*.html")
snippet = """
<!-- GTranslate: https://gtranslate.io/ -->
<div class="gtranslate_wrapper" style="position: fixed; bottom: 20px; left: 20px; z-index: 999999;"></div>
<script>window.gtranslateSettings = {"default_language":"tr","languages":["tr","en"],"wrapper_selector":".gtranslate_wrapper","flag_size":32}</script>
<script src="https://cdn.gtranslate.net/widgets/latest/flags.js" defer></script>
"""

for filepath in html_files:
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
    except UnicodeDecodeError:
        try:
            with open(filepath, "r", encoding="utf-16") as f:
                content = f.read()
        except:
            print(f"Failed to read {filepath}")
            continue
    
    if "gtranslate_wrapper" not in content:
        content = content.replace("</body>", snippet + "\n</body>")
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Injected into {filepath}")
        except Exception as e:
            print(f"Failed to write {filepath}: {e}")
    else:
        print(f"Already in {filepath}")
