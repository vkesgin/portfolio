from PIL import Image
import os, glob

for path in glob.glob('assets/images/**/*.jpg', recursive=True) + \
            glob.glob('assets/images/**/*.png', recursive=True):
    img  = Image.open(path)
    out  = path.rsplit('.',1)[0] + '.webp'
    img.save(out, 'WEBP', quality=82, method=6)
    orig = os.path.getsize(path)
    new  = os.path.getsize(out)
    print(f'{path} → {out} ({orig//1024}KB → {new//1024}KB)')
