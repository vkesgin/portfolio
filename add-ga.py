import os

ga_code = """<!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-NRXJP6L8XZ"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-NRXJP6L8XZ');
  </script>
"""

files = [
    'index.html',
    'pages/services.html',
    'pages/portfolio.html',
    'pages/about.html',
    'pages/contact.html',
    'pages/tool-pdf.html',
    'pages/tool-audio.html',
    'pages/tool-bg-remover.html',
    'pages/tool-image.html',
    'pages/tool-palette.html',
    'pages/tool-password.html',
    'pages/tool-qr.html',
    'pages/tool-converter.html'
]

for file_path in files:
    if os.path.exists(file_path):
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        if 'G-NRXJP6L8XZ' not in content:
            new_content = content.replace('</head>', f'{ga_code}</head>')
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f'Added to {file_path}')
        else:
            print(f'Already in {file_path}')
    else:
        print(f'Not found: {file_path}')
